import test from 'node:test';
import {readFile, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createGate} from '../functions/gate.mjs';
import {page} from '../pages.mjs';
const owner={uid:'owner',email_verified:true,auth_time:Date.now()/1000};
test('hosting sends studio routes and assets through the private gate',async()=>{
 const config=JSON.parse(await readFile(new URL('../firebase.json',import.meta.url),'utf8'));
 assert.equal(config.hosting.public,'hosting');
 assert.deepEqual(await readdir(new URL('../hosting/',import.meta.url)),['README.txt']);
 assert.deepEqual(config.hosting.rewrites,[{source:'**',function:{functionId:'privateStudio',region:'us-central1'}}]);
 assert.equal(config.functions.source,'functions');
 assert.ok(config.functions.predeploy.some(command=>command.includes('run build')));
});
function setup({claims=owner,uid='owner',valid=true}={}){
 let verified=0,revoked=false;
 const gate=createGate({ownerUid:()=>uid,origin:()=> 'https://studio.web.app',root:fileURLToPath(new URL('../public',import.meta.url)),loginFile:fileURLToPath(new URL('../functions/login.html',import.meta.url)),auth:{verifyIdToken:async()=>claims,createSessionCookie:async()=> 'signed-session',verifySessionCookie:async(cookie,check)=>{verified++;revoked=check;if(!valid||cookie!=='valid')throw Error();return claims}}});
 return {async request(path,options={}){const req={path,method:'GET',headers:{cookie:'__session=valid'},get:()=> 'https://studio.web.app',is:()=>true,...options};const res={statusCode:200,headers:{},set(k,v){this.headers[k]=v;return this},status(n){this.statusCode=n;return this},type(){return this},send(body){this.body=body;return this},json(body){this.body=body;return this},cookie(n,v,o){this.cookieValue={n,v,o};return this},clearCookie(){this.cleared=true;return this},redirect(n,url){this.statusCode=n;this.redirectTo=url;return this}};await gate(req,res);return res},checks:()=>({verified,revoked})};
}
test('every app file requires a verified owner session, checked for revocation',async()=>{for(const path of ['/','/workspace/','/main.js','/assets/montserrat.ttf','/examples/pulse-demo.musicxml']){assert.equal((await setup({valid:false}).request(path)).redirectTo,'/login');assert.equal((await setup({claims:{uid:'other',email_verified:true}}).request(path)).redirectTo,'/login')}const s=setup();assert.equal((await s.request('/music.js')).statusCode,200);assert.deepEqual(s.checks(),{verified:1,revoked:true})});
test('configuration is fail closed and login remains accessible',async()=>{const s=setup({uid:''});assert.equal((await s.request('/music.js')).statusCode,503);assert.equal((await s.request('/login')).statusCode,200)});
test('session login rejects other identities, unverified email, stale authentication and foreign origins',async()=>{for(const claims of [{...owner,uid:'other'},{...owner,email_verified:false},{...owner,auth_time:0}])assert.equal((await setup({claims}).request('/session/login',{method:'POST',body:{idToken:'id'}})).statusCode,403);assert.equal((await setup().request('/session/login',{method:'POST',get:()=> 'https://attacker.test'})).statusCode,403);assert.equal((await setup().request('/session/logout',{method:'POST',get:()=> 'https://attacker.test'})).statusCode,403)});
test('owner gets an HTTP-only secure session and logout clears it',async()=>{const s=setup();const r=await s.request('/session/login',{method:'POST',body:{idToken:'id'}});assert.equal(r.cookieValue.n,'__session');assert.equal(r.cookieValue.o.httpOnly,true);assert.equal(r.cookieValue.o.secure,true);assert.equal(r.cookieValue.o.sameSite,'strict');assert.equal((await s.request('/session/logout',{method:'POST'})).cleared,true)});
test('path traversal is refused and responses cannot be shared-cache stored',async()=>{const s=setup();assert.equal((await s.request('/%2e%2e/package.json')).statusCode,404);assert.equal((await s.request('/music.js')).headers['Cache-Control'],'private, no-store')});
test('design preview renders without live payment or registration controls',()=>{for(const route of ['','agents','tools','academy','plans','workspace','account','faq','contact']){const html=page(route);assert.doesNotMatch(html,/data-checkout|data-billing|CONFIRM TEST PLAN|autocomplete="cc-number"/);assert.match(html,/noindex,nofollow,noarchive/)}});
