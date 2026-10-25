const {test}=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module'),http=require('node:http'),{rootCertificates}=require('node:tls');
const original=Module._load;let state;
const keys=['identity','role_oid','database','flags','login','tls','addresses','isolation','path','statement','lock','idle','application','membership','ownership','ddl'];
class Client{}
class Pool{
 constructor(config){state.configs.push(config);}
 on(){}
 async connect(){state.leases++;return{query:async config=>{if(state.waitIdentity)await state.waitIdentity;state.identityQuery=config;return{rows:[Object.fromEntries(keys.map(k=>[k,k!=='tls'||!state.badTls]))]};},release(value){state.releases.push(value);}};}
 async query(config,values){
  if(typeof config==='object'){state.acls++;state.aclQuery=config;return{rows:[{relations:true,expected_columns:true,columns:!state.badAcl,tables:true,sequences:true,definer:true}]};}
  state.business.push([config,values]);if(state.waitBusiness)await state.waitBusiness;
  if(state.failBusiness)throw Error('PRIVATE_SQL_DETAIL');
  if(config.includes('FROM phone_numbers'))return{rows:[{tenant_id:2147483100,assigned_route_type:'extension',assigned_route_id:2147483110}]};
  return{rows:[{sip_username:'synthetic_owned',sip_domain:'owned.invalid'}]};
 }
 async end(){state.ends++;if(state.failEnd)throw Error('PRIVATE_END');}
}
Module._load=function(name,...args){
 if(name==='pg')return{Client,Pool};if(name==='pg/lib/client.js')return Client;
 if(name==='node:http')return{...http,createServer(...params){const s=http.createServer(...params);state.servers.push(s);if(state.delayListen){const actual=s.listen.bind(s);s.listen=(...listen)=>{state.resumeListen=()=>actual(...listen);return s;};}return s;}};
 return original.call(this,name,...args);
};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};},tick=()=>new Promise(r=>setImmediate(r));
async function until(p){for(let i=0;i<100;i++){if(p())return;await tick();}throw Error('OWNED_TEST_WAIT');}
async function availablePort(){const s=http.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
async function fixture(){
 for(const k of Object.keys(process.env))if(/^(PG|DATABASE|POSTGRES|DB_)/.test(k))delete process.env[k];
 state={configs:[],leases:0,releases:[],acls:0,business:[],ends:0,servers:[]};
 const file=require.resolve('../../.cache/phone11-did-runtime/did-listener.cjs');delete require.cache[file];const api=require(file);
 const binding={host:'127.0.0.1',port:await availablePort(),timeoutMs:2000,database:{host:'postgres',port:5432,database:'phone11ai',user:'phone11_did_owned',password:'PRIVATE_SYNTHETIC_PASSWORD',tlsCaPem:rootCertificates[0]},databaseAuthority:{roleOid:12345,databaseOid:54321,clientAddress:'127.0.0.1',serverAddress:'127.0.0.1',serverPort:5432},integrationSecret:'a'.repeat(64)};
 return{api,binding,url:'http://127.0.0.1:'+binding.port,async cleanup(){for(const s of state.servers){s.closeAllConnections();if(s.listening)await new Promise(r=>s.close(r));}}};
}
async function request(f,path='/api/kamailio/route',options={}){const r=await fetch(f.url+path,{method:'POST',...options,signal:AbortSignal.timeout(2000),headers:{connection:'close','content-type':'application/json',...options.headers},body:options.body??JSON.stringify({ruri_user:'+19995553150'})});return{status:r.status,text:await r.text()};}
const reject=(p,code)=>assert.rejects(p,e=>e.message===code&&!String(e).includes('PRIVATE'));
test('inert constructor; actual factory mounts only route and all header denials precede same-owned SQL',async()=>{
 const f=await fixture();try{assert.equal(state.configs.length,0);const c=f.api.createDidRoutingListener(f.binding);assert.equal(state.configs.length,0);assert.equal(state.servers.length,0);const start=c.start();assert.equal(c.start(),start);assert.deepEqual(await start,{state:'LISTENING',service:'phone11-did-routing'});assert.equal(state.leases,1);assert.equal(state.acls,1);assert.equal(state.configs[0].ssl.rejectUnauthorized,true);
 for(const secret of[undefined,'wrong'])assert.equal((await request(f,undefined,{headers:secret?{'x-kam-secret':secret}:{}})).status,403);
 for(const path of['/api/kamailio/auth','/api/kamailio/register','/api/cdr','/api/recordings/upload'])assert.equal((await request(f,path,{body:'not JSON'})).status,404);
 assert.equal(state.business.length,0);const positive=await request(f,undefined,{headers:{'x-kam-secret':f.binding.integrationSecret}});assert.equal(positive.status,200);assert.equal(JSON.parse(positive.text).target,'sip:synthetic_owned@owned.invalid');assert.equal(state.business.length,2);assert.deepEqual(state.business[1][1],[2147483110,2147483100]);const closing=c.close();assert.equal(c.close(),closing);await closing;assert.equal(state.ends,1);await reject(c.start(),'DID_LISTENER_START_REFUSED');
 }finally{await f.cleanup();}
});
test('copy-before-effects binds private host/secret/authority despite caller mutation; bad input is inert',async()=>{
 const f=await fixture();try{const c=f.api.createDidRoutingListener(f.binding),secret=f.binding.integrationSecret;f.binding.integrationSecret='b'.repeat(64);f.binding.port=1;f.binding.database.user='mutated';await c.start();assert.equal((await request(f,undefined,{headers:{'x-kam-secret':secret}})).status,200);assert.equal(state.configs[0].user,'phone11_did_owned');await c.close();
 for(const change of[b=>b.host='localhost',b=>b.integrationSecret='short',b=>b.integrationSecret=b.database.password,b=>b.port=0]){const b=structuredClone(f.binding);change(b);assert.throws(()=>f.api.createDidRoutingListener(b),/DID_LISTENER_START_REFUSED/);}
 }finally{await f.cleanup();}
});
test('same-pool identity or exact ACL mismatch refuses prelisten and discards/closes owned resource',async()=>{
 for(const kind of['identity','acl']){const f=await fixture();try{state.badTls=kind==='identity';state.badAcl=kind==='acl';const c=f.api.createDidRoutingListener(f.binding);await reject(c.start(),'DID_LISTENER_START_REFUSED');assert.equal(state.servers.length,0);assert.equal(state.ends,1);assert.deepEqual(state.releases,[kind==='identity'?true:undefined]);await c.close();}finally{await f.cleanup();}}
});
test('close pending same-owned attestation cannot later listen and closes only after actual setup settles',async()=>{
 const f=await fixture();try{const pause=deferred();state.waitIdentity=pause.promise;const c=f.api.createDidRoutingListener(f.binding),start=c.start();await until(()=>state.leases===1);const failure=reject(start,'DID_LISTENER_START_REFUSED'),closing=c.close();await tick();assert.equal(state.ends,0);pause.resolve();await failure;await closing;assert.equal(state.ends,1);assert.equal(state.servers.length,0);}finally{await f.cleanup();}
});
test('pending native bind is aborted; occupied port rejects with owned pool closed',async()=>{
 for(const delay of[true,false]){const f=await fixture();let occupied;try{if(delay)state.delayListen=true;else{occupied=http.createServer();await new Promise(r=>occupied.listen(f.binding.port,f.binding.host,r));}const c=f.api.createDidRoutingListener(f.binding),start=c.start(),failure=reject(start,'DID_LISTENER_START_REFUSED');if(delay){await until(()=>Boolean(state.resumeListen));const closing=c.close();state.resumeListen();await closing;}await failure;await c.close();assert.equal(state.ends,1);assert.equal(state.servers[0].listening,false);}finally{if(occupied)await new Promise(r=>occupied.close(r));await f.cleanup();}}
});
test('HTTP admitted query finishes before PG close; readonly factory SQL failure is sanitized',async()=>{
 const f=await fixture();try{const c=f.api.createDidRoutingListener(f.binding);await c.start();const pause=deferred();state.waitBusiness=pause.promise;const req=request(f,undefined,{headers:{'x-kam-secret':f.binding.integrationSecret}});await until(()=>state.business.length===1);const closing=c.close();await tick();assert.equal(state.ends,0);pause.resolve();assert.equal((await req).status,200);await closing;assert.equal(state.ends,1);}finally{await f.cleanup();}
 const f2=await fixture();const originalError=console.error;let logged='';try{console.error=(...x)=>{logged+=x.join(' ');};state.failBusiness=true;const c=f2.api.createDidRoutingListener(f2.binding);await c.start();const r=await request(f2,undefined,{headers:{'x-kam-secret':f2.binding.integrationSecret}});assert.equal(JSON.parse(r.text).code,500);assert(!logged.includes('PRIVATE'));assert(!r.text.includes('PRIVATE'));await c.close();}finally{console.error=originalError;await f2.cleanup();}
});
test('parser size/error output is finite; cleanup failure/ignored setup deadline never permits future listen',async()=>{
 const f=await fixture();try{const c=f.api.createDidRoutingListener(f.binding);await c.start();for(const[body,status]of[['{',400],[JSON.stringify({x:'x'.repeat(5000)}),413]]){const r=await request(f,undefined,{body});assert.equal(r.status,status);assert.equal(r.text,'{"error":"DID request invalid"}');}assert.equal(state.business.length,0);state.failEnd=true;await reject(c.close(),'DID_LISTENER_CLEANUP_UNCONFIRMED');}finally{await f.cleanup();}
 const f2=await fixture();try{const pause=deferred();state.waitIdentity=pause.promise;f2.binding.timeoutMs=10;const c=f2.api.createDidRoutingListener(f2.binding);await reject(c.start(),'DID_LISTENER_CLEANUP_UNCONFIRMED');await reject(c.close(),'DID_LISTENER_CLEANUP_UNCONFIRMED');pause.resolve();await tick();assert.equal(state.ends,0);assert.equal(state.servers.length,0);}finally{await f2.cleanup();}
});
test('close before start is terminal with no PG or HTTP effects',async()=>{const f=await fixture();try{const c=f.api.createDidRoutingListener(f.binding);await c.close();await reject(c.start(),'DID_LISTENER_START_REFUSED');assert.equal(state.configs.length,0);assert.equal(state.servers.length,0);}finally{await f.cleanup();}});

test('aborted HTTP handler cannot issue a later query; held SQL settles before pool end',async()=>{
 const f=await fixture(),error=console.error;try{console.error=()=>{};const c=f.api.createDidRoutingListener(f.binding);await c.start();const pause=deferred();state.waitBusiness=pause.promise;
 const req=http.request(f.url+'/api/kamailio/route',{method:'POST',headers:{'content-type':'application/json','x-kam-secret':f.binding.integrationSecret,connection:'close'}});req.on('error',()=>{});req.end(JSON.stringify({ruri_user:'+19995553150'}));await until(()=>state.business.length===1);req.destroy();await tick();const closing=c.close();await tick();assert.equal(state.ends,0);pause.resolve();await closing;await tick();assert.equal(state.ends,1);assert.equal(state.business.length,1);
 }finally{console.error=error;await f.cleanup();}
});
