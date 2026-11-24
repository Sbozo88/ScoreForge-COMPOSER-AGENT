import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable,Writable} from 'node:stream';
import {createPreviewHandler} from '../converter/preview.mjs';
import {analyzeMeasureNotes,auditNotation} from '../public/score-audit.js';
import {createConverterProxy} from '../functions/converter-proxy.mjs';

function makeXmlNode(tagName,attrs={},children=[],textContent=''){
 const node={tagName,attributes:attrs,children,textContent,
  getAttribute(k){return Object.hasOwn(this.attributes,k)?this.attributes[k]:null},
  querySelector(sel){return this.querySelectorAll(sel)[0]||null},
  querySelectorAll(sel){
   const parts=sel.split('>').map(s=>s.trim());
   const match=(el,t)=>el.tagName===t;
   if(parts.length===2&&parts[0]===':scope'){return this.children.filter(c=>match(c,parts[1]))}
   if(parts.length===2){
    const out=[];
    const walk=(el)=>{if(match(el,parts[0])){for(const c of el.children)if(match(c,parts[1]))out.push(c)}for(const c of el.children)walk(c)};
    walk(this);return out;
   }
   const out=[];
   const walk=(el)=>{for(const c of el.children){if(match(c,sel))out.push(c);walk(c)}};
   walk(this);return out;
  }
 };
 return node;
}

const el=(tag,attrs,children)=>makeXmlNode(tag,attrs,Array.isArray(children)?children:[],'');
const txt=(tag,value,attrs={})=>makeXmlNode(tag,attrs,[],String(value));

test('analyzeMeasureNotes tracks beat offsets, voices, and chord tones',()=>{
 const measure=el('measure',{number:'1'},[
  el('attributes',{},[txt('divisions','2')]),
  el('note',{},[el('pitch',{},[txt('step','C'),txt('octave','5')]),txt('duration','2'),txt('voice','1')]),
  el('note',{},[el('chord',{}),el('pitch',{},[txt('step','E'),txt('octave','5')]),txt('duration','2'),txt('voice','1')]),
  el('note',{},[el('pitch',{},[txt('step','D'),txt('octave','5')]),txt('duration','2'),txt('voice','1'),el('lyric',{number:'1'},[txt('syllabic','begin'),txt('text','Lu')])]),
  el('backup',{},[txt('duration','4')]),
  el('note',{},[el('pitch',{},[txt('step','A'),txt('octave','4')]),txt('duration','4'),txt('voice','2')])
 ]);
 const result=analyzeMeasureNotes(measure,1);
 assert.equal(result.divisions,2);
 assert.equal(result.rows.length,4);
 assert.deepEqual(result.rows.map(r=>[r.beat,r.voice,r.isChord]),[[1,'1',false],[1,'1',true],[2,'1',false],[1,'2',false]]);
 assert.equal(result.rows[2].lyrics[0].text,'Lu');
});

test('auditNotation flags chord-attached lyrics and unclosed hyphens',()=>{
 const doc=el('root',{},[
  el('score-partwise',{version:'4.0'},[
   el('part-list',{},[el('score-part',{id:'P1'},[txt('part-name','Soprano')])]),
   el('part',{id:'P1'},[
    el('measure',{number:'1'},[
     el('attributes',{},[txt('divisions','1')]),
     el('note',{},[el('pitch',{},[txt('step','C'),txt('octave','5')]),txt('duration','1'),txt('voice','1'),el('lyric',{number:'1'},[txt('syllabic','begin'),txt('text','Glo')])]),
     el('note',{},[el('chord',{}),el('pitch',{},[txt('step','E'),txt('octave','5')]),txt('duration','1'),txt('voice','1'),el('lyric',{number:'1'},[txt('syllabic','single'),txt('text','dup')])])
    ])
   ])
  ])
 ]);
 const audit=auditNotation(doc);
 assert.equal(audit.parts,1);
 assert.equal(audit.totalSyllables,2);
 assert.ok(audit.issues.some(i=>i.message.includes('chord tone')));
 assert.ok(audit.issues.some(i=>i.message.includes('unclosed hyphen')||i.message.includes('never closed')||i.message.includes('interrupted')));
});

test('firebase converter proxy enforces HTTPS and reports unconfigured worker',async()=>{
 const proxy=createConverterProxy({url:()=>'',secret:()=>''});
 const res={statusCode:200,body:null,status(n){this.statusCode=n;return this},json(b){this.body=b;return this}};
 await proxy({path:'/api/converter/health',method:'GET'},res);
 assert.equal(res.statusCode,503);
 assert.match(res.body.error,/not been configured/i);
});

async function call(handler,path,{method='GET',body='',headers={}}={}) {
 const req=Readable.from(body?[Buffer.from(body)]:[]);
 Object.assign(req,{url:path,method,headers:{host:'localhost:4173',...headers}});
 const chunks=[],responseHeaders={};
 const res=new Writable({write(chunk,encoding,done){chunks.push(chunk);done()}});
 res.setHeader=(k,v)=>{responseHeaders[k.toLowerCase()]=v};
 res.writeHead=(status,headers)=>{res.statusCode=status;for(const [k,v] of Object.entries(headers))res.setHeader(k,v)};
 await handler(req,res);
 return {status:res.statusCode||200,headers:responseHeaders,body:Buffer.concat(chunks).toString()};
}
test('preview forwards PDF uploads and downloads to the authenticated worker',async()=>{
 const secret='test-worker-secret-'.repeat(3),calls=[];
 const handler=createPreviewHandler({worker:'http://127.0.0.1:8080',secret,request:async(url,options)=>{
  const chunks=[];if(options.body)for await(const chunk of options.body)chunks.push(chunk);
  calls.push({url,options,body:Buffer.concat(chunks).toString()});
  if(url.endsWith('score.musicxml'))return new Response('<score-partwise/>',{headers:{'Content-Type':'application/vnd.recordare.musicxml+xml','Content-Disposition':'attachment; filename="score.musicxml"'}});
  return Response.json(options.method==='POST'?{id:'project-1',job:{status:'queued'}}:{ready:true},{status:options.method==='POST'?202:200});
 }});
 assert.equal(JSON.parse((await call(handler,'/api/converter/health')).body).ready,true);
 const body='--score-boundary\r\nContent-Disposition: form-data; name="file"; filename="score.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\nscore\r\n--score-boundary--\r\n';
 const upload=await call(handler,'/api/converter/projects',{method:'POST',headers:{origin:'http://localhost:4173','content-type':'multipart/form-data; boundary=score-boundary'},body});
 assert.equal(upload.status,202);assert.equal(JSON.parse(upload.body).id,'project-1');
 assert.equal(calls[1].body,body);assert.equal(calls[1].options.headers['Content-Type'],'multipart/form-data; boundary=score-boundary');
 assert.equal(calls[1].url,'http://127.0.0.1:8080/projects');assert.ok(calls.every(c=>c.options.headers.Authorization===`Bearer ${secret}`));
 const score=await call(handler,'/api/converter/projects/project-1/files/score.musicxml');
 assert.equal(score.body,'<score-partwise/>');assert.match(score.headers['content-disposition'],/score.musicxml/);
 assert.equal((await call(handler,'/api/converter/projects',{method:'POST',headers:{origin:'https://other.example'},body:'pdf'})).status,403);
 assert.equal((await call(handler,'/api/converter/private')).status,404);
 assert.equal((await call(handler,'/api/converter/projects',{headers:{host:'other.example'}})).status,403);
 assert.equal(calls.length,3);
});
test('missing worker configuration returns actionable JSON',async()=>{
 const response=await call(createPreviewHandler({worker:'',secret:''}),'/api/converter/health');
 assert.equal(response.status,503);assert.match(JSON.parse(response.body).error,/converter:start/);
});
test('remote worker requires HTTPS and cannot leak its secret through a redirect',async()=>{
 const response=await call(createPreviewHandler({worker:'http://remote.example',secret:'x'.repeat(32),request:()=>{throw Error('Should not connect')}}),'/api/converter/health');
 assert.equal(response.status,503);
 const handler=createPreviewHandler({worker:'https://worker.example',secret:'x'.repeat(32),request:async(url,options)=>{assert.equal(options.redirect,'error');throw Error('redirect')}});
 assert.equal((await call(handler,'/api/converter/health')).status,502);
});
