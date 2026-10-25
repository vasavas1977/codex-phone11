const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const http=require('node:http');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {rootCertificates}=require('node:tls');
const realLoad=Module._load;
const state={};
const keys=['identity','role_oid','database','flags','login','tls','addresses','isolation','path','statement','lock','idle','application','membership','ownership','ddl'];
class Client{}
class Pool{
 constructor(){state.pools++;}
 on(){}
 async connect(){state.queries++;if(state.queryWait)await state.queryWait;return {query:async()=>({rows:[Object.fromEntries(keys.map(k=>[k,!state.badAuthority]))]}),release(){state.releases++;}};}
 async end(){state.ends++;if(state.endFails)throw Error('PRIVATE_END_FAILURE');}
 async query(){throw Error('UNQUALIFIED_BUSINESS_SQL');}
}
// Actual filesystem, HTTP server, route/pool/lifecycle graph. Only vendor PG /
// auth transports are inert; controllable builtin waits expose startup races.
Module._load=function(name,...args){
 if(name==='pg')return {Pool,Client};
 if(name==='pg/lib/client.js')return Client;
 if(name==='better-auth')return {betterAuth(){state.auth++;return {api:{getSession:async()=>{state.authQueries++;if(state.authWait)await state.authWait;return null;}}};}};
 if(name==='node:fs/promises')return {...fs,open:async(...params)=>{state.openCalls++;if(state.openWait)await state.openWait;const handle=await fs.open(...params);state.handles.push(handle);return handle;}};
 if(name==='node:http')return {...http,createServer(...params){const server=http.createServer(...params);state.servers.push(server);
  if(state.delayListen){const original=server.listen.bind(server);server.listen=(...listenArgs)=>{state.resumeListen=()=>original(...listenArgs);return server;};}
  return server;}};
 return realLoad.call(this,name,...args);
};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await tick();}throw Error('TEST_WAIT_FAILED');}
async function rejection(p,code){await assert.rejects(p,e=>e.message===code&&!JSON.stringify(e).includes('PRIVATE'));}
async function port(){const server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const result=server.address().port;await new Promise(r=>server.close(r));return result;}
async function fixture(){
 for(const key of Object.keys(process.env))if(/^(PHONE11_AUTH_|PHONE11_PASSWORD_RESET_|PHONE11_WAKE_|APNS_|PUSH_|PG|DATABASE|POSTGRES|DB_)/.test(key)||['RECORDINGS_PATH','PHONE11_CHAT_MEDIA_PATH'].includes(key))delete process.env[key];
 Object.assign(state,{pools:0,queries:0,releases:0,ends:0,auth:0,authQueries:0,openCalls:0,handles:[],servers:[],queryWait:null,openWait:null,authWait:null,delayListen:false,resumeListen:null,badAuthority:false,endFails:false});
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'phone11-retained-listener-'));
 const recordings=path.join(directory,'recordings'),chat=path.join(directory,'chat');await fs.mkdir(recordings,{mode:0o700});await fs.mkdir(chat,{mode:0o700});
 const identity=async p=>{const s=await fs.stat(p);return {device:s.dev,inode:s.ino,uid:s.uid,gid:s.gid,mode:0o700};};
 const input={host:'127.0.0.1',port:await port(),shutdownTimeoutMs:2000,runtime:{database:{host:'postgres',port:5432,database:'phone11ai',user:'phone11_retained_runtime',password:'PRIVATE_PASSWORD',tlsCaPem:rootCertificates[0]},databaseAuthority:{roleOid:12345,databaseOid:54321,clientAddress:'127.0.0.1',serverAddress:'127.0.0.1',serverPort:5432},auth:{baseURL:'https://auth.invalid',secret:'PRIVATE_AUTH_SECRET_LONG_ENOUGH_32',trustedOrigins:[]},recordingsPath:recordings,chatMediaPath:chat},storage:{recordings:await identity(recordings),chatMedia:await identity(chat)}};
 const artifact='../../.cache/phone11-retained-runtime/retained-listener.cjs';delete require.cache[require.resolve(artifact)];const api=require(artifact);
 return {input,api,url:`http://127.0.0.1:${input.port}`,async cleanup(){for(const s of state.servers){s.closeAllConnections();if(s.listening)await new Promise(r=>s.close(r));}for(const h of state.handles)await h.close().catch(()=>{});await fs.rm(directory,{recursive:true,force:true});}};
}
async function response(url,expected,options={}){const r=await fetch(url,{...options,headers:{connection:'close',...options.headers}});assert.equal(r.status,expected,url);await r.arrayBuffer();}

test('import/constructor are inert; explicit listener uses default auth-playback and static compatibility without workers',async()=>{
 const f=await fixture();try{assert.equal(state.pools,0);const c=f.api.createRetainedApiListener(f.input);assert.equal(state.openCalls,0);assert.equal(state.servers.length,0);
  const opening=c.start();assert.equal(c.start(),opening);assert.deepEqual(await opening,{state:'LISTENING',profile:'auth-playback'});assert.equal(state.pools,1);
  for(const p of ['/health','/api/health'])await response(f.url+p,200);
  await response(f.url+'/api/ws/status',503);await response(f.url+'/manus-storage/old',503);
  for(const p of ['/api/oauth/old','/api/auth/session','/api/auth/logout'])await response(f.url+p,410,{method:'POST'});
  for(const p of ['/api/auth/get-session','/api/trpc/x','/api/chat/media/owned','/api/recordings/voicemail/1','/api/kamailio/route'])await response(f.url+p,404);
  for(const p of ['/api/chat/media/upload','/api/phone11/wake/terminal','/api/cdr','/api/recordings/upload'])await response(f.url+p,404,{method:'POST'});
  assert.equal(state.queries,1);assert.equal(state.auth,0);await response(f.url+'/api/auth/me',401);await response(f.url+'/api/recordings/play/owned',401);
  const closing=c.close();assert.equal(c.close(),closing);await closing;assert.equal(state.ends,1);assert.equal(state.servers[0].listening,false);await rejection(c.start(),'RETAINED_LISTENER_START_REFUSED');
 }finally{await f.cleanup();}
});
test('full profile uses actual routes with explicit wake settings; denied native requests start no provider or business SQL',async()=>{
 const f=await fixture();try{f.input.runtime.profile='retained-full';f.input.runtime.wake={pilotSipUris:['sip:pilot_3001@pilot.invalid'],pushSharedSecret:'PRIVATE_PUSH_SECRET_LONG_ENOUGH_32',apns:{keyPath:'/owned/private/key.p8',keyId:'ABCDEFGHIJ',teamId:'KLMNOPQRST',bundleId:'invalid.phone11.app',environment:'sandbox'}};
  const c=f.api.createRetainedApiListener(f.input);await c.start();await response(f.url+'/api/chat/media/owned',401);
  for(const action of ['offer','terminal'])await response(f.url+'/api/phone11/wake/'+action,403,{method:'POST',headers:{'content-type':'application/json','x-push-secret':'wrong'},body:'{}'});
  assert.equal(state.queries,1);assert.equal(state.pools,1);await c.close();assert.equal(state.ends,1);
 }finally{await f.cleanup();}
});
test('explicit input copy prevents later profile/port/storage config mutation',async()=>{
 const f=await fixture();try{const c=f.api.createRetainedApiListener(f.input);f.input.port=1;f.input.runtime.profile='retained-full';f.input.storage.recordings.inode=1;
  assert.equal((await c.start()).profile,'auth-playback');await response(f.url+'/health',200);await c.close();
 }finally{await f.cleanup();}
});
test('unsafe host/port/process owner/storage metadata are refused before PG; exact inode mismatch and symlink fail closed',async()=>{
 for(const alter of [i=>i.host='localhost',i=>i.port=0,i=>i.storage.recordings.uid=-1,i=>i.storage.recordings.mode=0o755]){
  const f=await fixture();try{alter(f.input);assert.throws(()=>f.api.createRetainedApiListener(f.input),/RETAINED_LISTENER_START_REFUSED/);assert.equal(state.pools,0);}finally{await f.cleanup();}
 }
 for(const symlink of [false,true]){const f=await fixture();try{if(symlink){const link=f.input.runtime.recordingsPath+'-link';await fs.symlink(f.input.runtime.recordingsPath,link);f.input.runtime.recordingsPath=link;}else f.input.storage.recordings.inode++;
  const c=f.api.createRetainedApiListener(f.input);await rejection(c.start(),'RETAINED_LISTENER_START_REFUSED');await c.close();assert.equal(state.pools,0);assert.equal(state.servers.length,0);
 }finally{await f.cleanup();}}
});
test('close while directory open is pending cannot later bind and closes the exact subsequently returned handle',async()=>{
 const f=await fixture();try{const pause=deferred();state.openWait=pause.promise;const c=f.api.createRetainedApiListener(f.input),opening=c.start();await until(()=>state.openCalls===1);
  const rejected=rejection(opening,'RETAINED_LISTENER_START_REFUSED'),closing=c.close();assert.equal(c.close(),closing);pause.resolve();await rejected;await closing;
  assert.equal(state.pools,0);assert.equal(state.servers.length,0);await assert.rejects(state.handles[0].stat(),{code:'EBADF'});
 }finally{await f.cleanup();}
});
test('close during actual same-pool readiness waits its settlement, then closes pool without listening',async()=>{
 const f=await fixture();try{const pause=deferred();state.queryWait=pause.promise;const c=f.api.createRetainedApiListener(f.input),opening=c.start();await until(()=>state.queries===1);
  const rejected=rejection(opening,'RETAINED_LISTENER_START_REFUSED'),closing=c.close();await tick();assert.equal(state.ends,0);pause.resolve();await rejected;await closing;
  assert.equal(state.ends,1);assert.equal(state.servers.length,0);assert.equal(state.releases,1);
 }finally{await f.cleanup();}
});
test('close during pending native bind uses AbortSignal: no future LISTENING or leaked listener',async()=>{
 const f=await fixture();try{state.delayListen=true;const c=f.api.createRetainedApiListener(f.input),opening=c.start();await until(()=>Boolean(state.resumeListen));
  const rejected=rejection(opening,'RETAINED_LISTENER_START_REFUSED'),closing=c.close();state.resumeListen();await rejected;await closing;assert.equal(state.ends,1);assert.equal(state.servers[0].listening,false);
  await assert.rejects(fetch(f.url+'/health'));
 }finally{await f.cleanup();}
});
test('wrong authority and EADDRINUSE never report readiness and terminally close the owned graph',async()=>{
 for(const conflict of [false,true]){const f=await fixture();let occupied;try{if(conflict){occupied=http.createServer();await new Promise(r=>occupied.listen(f.input.port,f.input.host,r));}else state.badAuthority=true;
  const c=f.api.createRetainedApiListener(f.input);await rejection(c.start(),'RETAINED_LISTENER_START_REFUSED');await c.close();assert.equal(state.ends,1);assert.equal(state.auth,0);
 }finally{if(occupied)await new Promise(r=>occupied.close(r));await f.cleanup();}}
});
test('maintained shutdown waits an admitted actual auth handler before ending its same graph pool',async()=>{
 const f=await fixture();try{const pause=deferred();state.authWait=pause.promise;const c=f.api.createRetainedApiListener(f.input);await c.start();const request=response(f.url+'/api/auth/me',401);await until(()=>state.authQueries===1);
  const closing=c.close();await tick();assert.equal(state.ends,0);pause.resolve();await request;await closing;assert.equal(state.ends,1);
 }finally{await f.cleanup();}
});
test('pool close failure and setup that ignores deadline stay cleanup-unconfirmed, no retry or future listen',async()=>{
 for(const pending of [false,true]){const f=await fixture();try{const pause=deferred();if(pending){state.queryWait=pause.promise;f.input.shutdownTimeoutMs=20;}else state.endFails=true;
  const c=f.api.createRetainedApiListener(f.input);if(pending){await rejection(c.start(),'RETAINED_LISTENER_CLEANUP_UNCONFIRMED');const p=c.close();assert.equal(c.close(),p);await rejection(p,'RETAINED_LISTENER_CLEANUP_UNCONFIRMED');pause.resolve();await tick();assert.equal(state.servers.length,0);assert.equal(state.ends,0);}
  else{await c.start();const p=c.close();assert.equal(c.close(),p);await rejection(p,'RETAINED_LISTENER_CLEANUP_UNCONFIRMED');assert.equal(state.ends,1);}
 }finally{await f.cleanup();}}
});
test('close before start is terminal and inert',async()=>{
 const f=await fixture();try{const c=f.api.createRetainedApiListener(f.input),p=c.close();assert.equal(c.close(),p);await p;await rejection(c.start(),'RETAINED_LISTENER_START_REFUSED');assert.equal(state.pools,0);assert.equal(state.openCalls,0);}finally{await f.cleanup();}
});
