import {readFile, stat} from 'node:fs/promises';
import {resolve, sep, extname} from 'node:path';

export const isOwner = (claims, owner) => Boolean(owner && claims?.uid === owner && claims.email_verified === true);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.ttf':'font/ttf','.wav':'audio/wav','.musicxml':'application/vnd.recordare.musicxml+xml'};
export function createGate({auth, ownerUid, origin, root, loginFile, converter}) {
  return async (req,res) => {
    res.set('Cache-Control','private, no-store');
    res.set('X-Content-Type-Options','nosniff');
    res.set('X-Frame-Options','DENY');
    res.set('X-Robots-Tag','noindex, nofollow, noarchive');
    const path=req.path;
    if(path==='/login' && ['GET','HEAD'].includes(req.method)) return res.type('html').send(await readFile(loginFile,'utf8'));
    if(!ownerUid() || !origin()) return res.status(503).send('Private studio is awaiting owner configuration. Access is closed.');
    if(path.startsWith('/session/')) {
      if(req.method!=='POST') return res.status(405).send('Method not allowed');
      if(req.get('origin')!==origin() || !req.is('application/json')) return res.status(403).send('Request refused');
      if(path==='/session/logout') {
        res.clearCookie('__session',{path:'/',secure:true,httpOnly:true,sameSite:'strict'});
        return res.status(200).json({ok:true});
      }
      if(path!=='/session/login') return res.status(404).send('Not found');
      try {
        const token=req.body?.idToken;
        if(typeof token!=='string' || token.length>16384) throw Error('Invalid token');
        const claims=await auth.verifyIdToken(token,true);
        if(!isOwner(claims,ownerUid()) || !Number.isFinite(claims.auth_time) || Math.abs(Date.now()/1000-claims.auth_time)>300) return res.status(403).send('This studio is reserved for its owner.');
        const expiresIn=8*60*60*1000;
        const cookie=await auth.createSessionCookie(token,{expiresIn});
        res.cookie('__session',cookie,{maxAge:expiresIn,path:'/',secure:true,httpOnly:true,sameSite:'strict'});
        return res.status(200).json({ok:true});
      } catch {return res.status(401).send('Please sign in again.');}
    }
    const isConverter=path.startsWith('/api/converter/');
    if(!isConverter && !['GET','HEAD'].includes(req.method)) return res.status(405).send('Method not allowed');
    if(isConverter && !['GET','HEAD'].includes(req.method) && req.get('origin')!==origin()) return res.status(403).json({error:'Request refused'});
    try {
      const cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('__session='))?.slice(10);
      const claims=await auth.verifySessionCookie(cookie||'',true);
      if(!isOwner(claims,ownerUid())) throw Error('Not owner');
    } catch {return res.redirect(303,'/login');}
    if(isConverter) {
      if(!converter) return res.status(503).json({error:'The score conversion worker has not been configured.'});
      return converter(req,res);
    }
    try {
      const base=resolve(root), name=decodeURIComponent(path);
      let file=resolve(base,'.'+name);
      if(!file.startsWith(base+sep) && file!==base) return res.status(404).send('Not found');
      if((await stat(file)).isDirectory()) file=resolve(file,'index.html');
      const data=await readFile(file);
      return res.type(types[extname(file)]||'application/octet-stream').send(data);
    } catch {return res.status(404).send('Not found');}
  };
}
