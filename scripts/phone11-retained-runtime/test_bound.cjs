const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const {rootCertificates}=require('node:tls');
const {createServer}=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const realLoad=Module._load;
const shared={configs:[],auth:[],end:0,sql:0,failEnd:false,failImport:false};
class JsClient{}
class Pool{
 constructor(config){shared.configs.push(config);}
 on(){}
 async end(){shared.end++;if(shared.failEnd)throw Error('PRIVATE_CLOSE_DETAIL');}
 async query(){shared.sql++;throw Error('UNQUALIFIED_SQL_FORBIDDEN');}
 async connect(){throw Error('UNQUALIFIED_SQL_FORBIDDEN');}
}
// Only external transport/vendor construction is inert. The bundled maintained
// configure/get/close functions and route/default SDK code are actual source.
Module._load=function(name,...args){
 if(name==='pg')return {Client:JsClient,Pool};
 if(name==='pg/lib/client.js')return JsClient;
 if(name==='better-auth')return {betterAuth(options){shared.auth.push(options);return {api:{getSession:async()=>null}};}};
 if(shared.failImport&&name==='express')throw Error('PRIVATE_IMPORT_DETAIL');
 return realLoad.call(this,name,...args);
};
const envKeys=['PHONE11_AUTH_BASE_URL','PHONE11_AUTH_SECRET','PHONE11_AUTH_TRUSTED_ORIGINS','RECORDINGS_PATH','PHONE11_CHAT_MEDIA_PATH','PHONE11_PASSWORD_RESET_PROVIDER','PHONE11_PASSWORD_RESET_RESEND_API_KEY','PHONE11_PASSWORD_RESET_FROM'];
function reset(){
 for(const k of envKeys)delete process.env[k];
 for(const k of Object.keys(process.env))if(/^(PG|DB_|POSTGRES|DATABASE|APNS|PUSH_)/.test(k))delete process.env[k];
 Object.assign(shared,{configs:[],auth:[],end:0,sql:0,failEnd:false,failImport:false});
 delete require.cache[require.resolve('../../.cache/phone11-retained-runtime/retained-bound.cjs')];return require('../../.cache/phone11-retained-runtime/retained-bound.cjs');
}
const binding=()=>({database:{host:'postgres',port:5432,database:'phone11ai',user:'phone11_retained_runtime',password:'PRIVATE_TEST_PASSWORD',tlsCaPem:rootCertificates[0]},
 auth:{baseURL:'https://auth.example.invalid',secret:'PRIVATE_SYNTHETIC_AUTH_SECRET_32_BYTES',trustedOrigins:[]},recordingsPath:'/owned/synthetic/recordings',chatMediaPath:'/owned/synthetic/chat'});
async function rejected(promise,code){const e=await promise.catch(e=>e);assert(e instanceof Error);assert.equal(e.message,code);assert.equal(e.cause,undefined);assert(!JSON.stringify(e).includes('PRIVATE'));}
async function serve(app,fn){const server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));try{await fn(server,`http://127.0.0.1:${server.address().port}`);}finally{if(server.listening)await new Promise((r,j)=>server.close(e=>e?j(e):r()));}}

test('import/setup creates no pool/auth/listener or workers; one private setup attempt only',async()=>{
 const m=reset();assert.deepEqual(Object.keys(m),['createBoundRetainedRuntime']);assert.equal(shared.configs.length,0);
 const c=await m.createBoundRetainedRuntime(binding());assert.equal(shared.configs.length,0);assert.equal(shared.auth.length,0);
 assert.equal(c.plan.startsBackgroundServices,false);assert.equal('start'in c,false);assert.equal('getPool'in c,false);
 await rejected(m.createBoundRetainedRuntime(binding()),'RETAINED_BOUND_SETUP_REFUSED');await c.close();assert.equal(shared.end,0);
});
test('actual auth/me and SDK media/playback share one owned graph pool and two auth instances',async()=>{
 const m=reset(),c=await m.createBoundRetainedRuntime(binding());
 await serve(c.app,async(server,url)=>{
  for(const p of ['/api/auth/me','/api/chat/media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','/api/recordings/play/synthetic']){
   const r=await fetch(url+p,{headers:{connection:'close'}});assert.equal(r.status,401,p);await r.arrayBuffer();
  }
  assert.equal(shared.configs.length,1);assert.equal(shared.auth.length,2);assert.equal(shared.sql,0);
  const a=shared.auth[0].database;assert.equal(shared.auth[1].database,a);
  assert.equal(shared.configs[0].ssl.rejectUnauthorized,true);assert.equal(shared.configs[0].password,'PRIVATE_TEST_PASSWORD');
  const stop=c.createShutdown(server,2000),p=stop();assert.equal(stop(),p);await p;assert.equal(shared.end,1);
 });
 await c.close();assert.equal(shared.end,1);
});
test('excluded routes never create auth/PG/provider resources',async()=>{
 const m=reset(),c=await m.createBoundRetainedRuntime(binding());
 await serve(c.app,async(_server,url)=>{for(const [method,p]of[['GET','/api/auth/get-session'],['POST','/api/auth/sign-in/email'],['POST','/api/recordings/upload'],['GET','/api/recordings/voicemail/1'],['POST','/api/cdr'],['GET','/api/trpc/x']]){
  const r=await fetch(url+p,{method,headers:{connection:'close'}});assert.equal(r.status,404,p);await r.arrayBuffer();
 }});assert.equal(shared.configs.length,0);assert.equal(shared.auth.length,0);await c.close();
});
test('conflicting auth/storage or mailer env refuses before owned pool setup; failed attempt stays terminal',async()=>{
 for(const key of ['PHONE11_AUTH_SECRET','RECORDINGS_PATH','PHONE11_PASSWORD_RESET_PROVIDER']){
  const m=reset();process.env[key]='PRIVATE_CONFLICT';await rejected(m.createBoundRetainedRuntime(binding()),'RETAINED_BOUND_SETUP_REFUSED');
  delete process.env[key];await rejected(m.createBoundRetainedRuntime(binding()),'RETAINED_BOUND_SETUP_REFUSED');assert.equal(shared.configs.length,0);
 }
});
test('invalid private auth/path/database values refuse finitely without reading storage or connecting',async()=>{
 for(const change of [b=>b.auth.secret='short',b=>b.recordingsPath='relative',b=>b.chatMediaPath='/x/../y',b=>b.database.tlsCaPem='PRIVATE_BAD_CA']){
  const m=reset(),b=binding();change(b);await rejected(m.createBoundRetainedRuntime(b),'RETAINED_BOUND_SETUP_REFUSED');assert.equal(shared.configs.length,0);
 }
});
test('environment drift and terminal close stop admitted requests before lazy auth/pool use',async()=>{
 const m=reset(),c=await m.createBoundRetainedRuntime(binding());process.env.PHONE11_AUTH_SECRET='PRIVATE_DRIFT';
 await serve(c.app,async(_server,url)=>{let r=await fetch(url+'/api/auth/me',{headers:{connection:'close'}});assert.equal(r.status,503);await r.arrayBuffer();
  process.env.PHONE11_AUTH_SECRET=binding().auth.secret;await c.close();r=await fetch(url+'/api/auth/me',{headers:{connection:'close'}});assert.equal(r.status,503);await r.arrayBuffer();
 });assert.equal(shared.configs.length,0);assert.equal(shared.auth.length,0);
});
test('private auth validation always uses production rules, including when ambient NODE_ENV permits loopback development',async()=>{
 const prior=process.env.NODE_ENV;process.env.NODE_ENV='development';
 try{for(const change of [b=>b.auth.baseURL='http://127.0.0.1:8080',b=>b.auth.trustedOrigins=['http://localhost:8080']]){
  const m=reset(),b=binding();change(b);await rejected(m.createBoundRetainedRuntime(b),'RETAINED_BOUND_SETUP_REFUSED');assert.equal(shared.configs.length,0);assert.equal(shared.auth.length,0);
 }}finally{if(prior===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=prior;}
});
test('dynamic-import failure after private binding is terminal without partial retry',async()=>{
 const m=reset();shared.failImport=true;await rejected(m.createBoundRetainedRuntime(binding()),'RETAINED_BOUND_SETUP_REFUSED');
 shared.failImport=false;await rejected(m.createBoundRetainedRuntime(binding()),'RETAINED_BOUND_SETUP_REFUSED');assert.equal(shared.configs.length,0);assert.equal(shared.end,0);
});
test('actual graph pool close failure is finite, terminal and never retried',async()=>{
 const m=reset(),c=await m.createBoundRetainedRuntime(binding());
 await serve(c.app,async(_server,url)=>{const r=await fetch(url+'/api/auth/me',{headers:{connection:'close'}});assert.equal(r.status,401);await r.arrayBuffer();});
 shared.failEnd=true;const p=c.close();assert.equal(c.close(),p);await rejected(p,'PBX_OWNED_POOL_CLOSE_UNCONFIRMED');assert.equal(shared.end,1);
 await rejected(m.createBoundRetainedRuntime(binding()),'RETAINED_BOUND_SETUP_REFUSED');
});
test('artifact graph has one actual db module and includes maintained TLS driver/lifecycle without global index',()=>{
 const m=JSON.parse(fs.readFileSync(path.join(__dirname,'../../.cache/phone11-retained-runtime/SOURCE-MANIFEST.json')));
 assert.equal(m.inputs.filter(x=>('/'+x.path).endsWith('/server/pbx/db.ts')).length,1);assert(m.inputs.some(x=>('/'+x.path).endsWith('/server/pbx/js-postgres-driver.ts')));
 assert(m.inputs.some(x=>('/'+x.path).endsWith('/server/_core/runtime-role.ts')));assert(!m.inputs.some(x=>('/'+x.path).endsWith('/server/_core/index.ts')));assert.equal(m.restrictedDatabaseProof,false);
});
