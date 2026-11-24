// The existing owner-only gate invokes this only after session verification.
export function createConverterProxy({url,secret,request=fetch}) {
 return async(req,res)=>{
  const target=url(),token=secret();
  if(!target||!token)return res.status(503).json({error:'The score conversion worker has not been configured. Your PDF has not been uploaded.'});
  if(!/^https:\/\//.test(target))return res.status(503).json({error:'The conversion service requires HTTPS.'});
  const suffix=req.originalUrl?.split('/api/converter')[1]||req.path.slice('/api/converter'.length);
  if(!/^\/(health|projects)([/?]|$)/.test(suffix))return res.status(404).json({error:'Not found'});
  try{
   const headers={Authorization:`Bearer ${token}`,'Content-Type':req.get('content-type')||'application/json'};
   const upstream=await request(target.replace(/\/$/,'')+suffix,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:(req.rawBody||JSON.stringify(req.body)),signal:AbortSignal.timeout(55000),redirect:'error'});
   if(/\/files\/original\.pdf(?:$|\?)/.test(suffix))res.set('X-Frame-Options','SAMEORIGIN');
   res.status(upstream.status).type(upstream.headers.get('content-type')||'application/json');
   const disposition=upstream.headers.get('content-disposition');if(disposition)res.set('Content-Disposition',disposition);
   return res.send(Buffer.from(await upstream.arrayBuffer()));
  }catch{return res.status(502).json({error:'The score service could not be reached. Please try again.'})}
 };
}
