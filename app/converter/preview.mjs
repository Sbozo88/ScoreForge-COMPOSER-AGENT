import {createServer} from 'node:http';
import {readFile, realpath, stat} from 'node:fs/promises';
import {resolve, sep, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ttf':'font/ttf','.wav':'audio/wav','.musicxml':'application/vnd.recordare.musicxml+xml'};
// Local preview only. Public hosting continues to use the Firebase owner gate.
export function createPreviewHandler({root=fileURLToPath(new URL('../dist/',import.meta.url)),worker=process.env.CONVERTER_URL,secret=process.env.CONVERTER_SECRET,request=fetch}={}) {
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  const json=(status,error)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({error}))};
  try {
   const host=new URL('http://'+req.headers.host);
   if(!['localhost','127.0.0.1','[::1]'].includes(host.hostname))return json(403,'Use the converter on localhost.');
   const url=new URL(req.url,'http://localhost');
   if(url.pathname.startsWith('/api/converter/')) {
    const suffix=url.pathname.slice('/api/converter'.length)+url.search;
    if(!/^\/(health|projects)([/?]|$)/.test(suffix))return json(404,'Not found');
    if(!worker||!secret||secret.length<32)return json(503,'Start the PDF worker with npm run converter:start.');
    if(!['GET','HEAD'].includes(req.method)) {
     const origin=req.headers.origin;
     if(!origin||new URL(origin).host!==req.headers.host)return json(403,'Request refused');
     if(!['POST'].includes(req.method))return json(405,'Method not allowed');
    }
    const target=new URL(worker);
    // HTTP is allowed only for local/container communication.
    if(target.protocol!=='https:'&&!(target.protocol==='http:'&&['localhost','127.0.0.1','score-converter'].includes(target.hostname)))return json(503,'The remote PDF worker requires HTTPS.');
    const headers={Authorization:`Bearer ${secret}`};
    if(req.headers['content-type'])headers['Content-Type']=req.headers['content-type'];
    if(req.headers['content-length']) {
     if(Number(req.headers['content-length'])>26*1024*1024)return json(413,'Choose a PDF smaller than 25 MB.');
     headers['Content-Length']=req.headers['content-length'];
    }
    let bytes=0;
    async function* body(){for await(const chunk of req){bytes+=chunk.length;if(bytes>26*1024*1024)throw Error('Upload too large');yield chunk}}
    const upstream=await request(worker.replace(/\/$/,'')+suffix,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:body(),duplex:'half'}:{}),redirect:'error',signal:AbortSignal.timeout(55000)});
    res.statusCode=upstream.status;
    for(const key of ['content-type','content-disposition'])if(upstream.headers.has(key))res.setHeader(key,upstream.headers.get(key));
    if(upstream.body&&req.method!=='HEAD')await pipeline(Readable.fromWeb(upstream.body),res);else res.end();
    return;
   }
   if(!['GET','HEAD'].includes(req.method))return json(405,'Method not allowed');
   const base=await realpath(root);
   let file=resolve(base,'.'+decodeURIComponent(url.pathname));
   if(file!==base&&!file.startsWith(base+sep))return json(404,'Not found');
   if((await stat(file)).isDirectory())file=resolve(file,'index.html');
   file=await realpath(file);
   if(!file.startsWith(base+sep))return json(404,'Not found');
   const data=await readFile(file);
   res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');
   res.end(req.method==='HEAD'?undefined:data);
  } catch(error) {
   if(res.headersSent){res.destroy();return}
   json(error.code==='ENOENT'?404:502,error.code==='ENOENT'?'Not found':'The PDF worker could not be reached. Check that the converter containers are running.');
  }
 };
}
export function createPreview(options){return createServer(createPreviewHandler(options))}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const port=Number(process.env.PORT||4173);
 createPreview().listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Score Converter preview: http://localhost:${port}/score-converter/`));
}
