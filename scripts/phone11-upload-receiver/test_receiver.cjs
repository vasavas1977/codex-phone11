'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const candidate=require('./upload-receiver.cjs');
const identity=()=>({exact:true,restricted:true,tls:true,no_memberships:true,no_ownership:true,no_db_create:true,no_schema_create:true});
const pins=()=>({database_name:true,database_oid:true,role_oid:true,server_version:true});
const binding=()=>({schema:'PHONE11_UPLOAD_RECEIVER_PRIVATE_BINDING_V1',port:18991,listenHost:'127.0.0.1',captureEnabled:true,integrationSecret:'owned-synthetic-private-secret-0123456789',storage:{path:'/owned-fixture-recordings',uid:1234,gid:1234,mode:0o700},processIdentity:{uid:1234,gid:1234},database:{host:'owned-pg.invalid',port:18992,name:'owned_fixture_db',role:'owned_fixture_role',password:'owned-fixture-password',databaseOid:'12345',roleOid:'23456',serverVersion:'160013',ca:'-----BEGIN CERTIFICATE-----\nOWNED_SYNTHETIC_FIXTURE\n-----END CERTIFICATE-----'}});
function fixture(options={}){
 const events=[],routes=[],pools=[];let count=0,releaseListener;
 class Pool{
  constructor(config){events.push('pool');this.config=config;pools.push(this);}
  on(){return this;}
  async query(input,args){events.push('query');const sql=typeof input==='string'?input:input.text,values=typeof input==='string'?args:input.values;this.queries??=[];this.queries.push(input);this.last={sql,args:values};if(options.query)return options.query(sql,values,++count);return{rows:[sql.startsWith('SELECT current_user=')?identity():pins()]};}
  async end(){events.push('end');if(options.neverEnd)return new Promise(()=>{});}
 }
 const app={disable(){},get(name,fn){routes.push({method:'GET',name,fn});},use(name,router){routes.push({method:'USE',name,router});}};
 function express(){return app;}express.Router=()=>({post(name,...handlers){routes.push({method:'POST',name,handlers});}});express.raw=()=>function ownedRawParser(){};
 const metadata={uid:1234,gid:1234,mode:0o40700,isDirectory:()=>true};const f={promises:{async lstat(){events.push('lstat');if(options.lstat)return options.lstat();return{isSymbolicLink:()=>!!options.symlink};},async realpath(p){events.push('realpath');return p;},async stat(){events.push('stat');return{...metadata,...options.metadata};}},constants:fs.constants};
 const http={createServer(){events.push('createServer');const server=new EventEmitter();server.listening=false;server.listen=opts=>{events.push('listen');server.listener=opts;opts.signal.addEventListener('abort',()=>server.close(()=>{}),{once:true});releaseListener=()=>{if(opts.signal.aborted)return;server.listening=true;events.push('listening');server.emit('listening');};if(!options.listenerPending)queueMicrotask(releaseListener);};server.close=fn=>{events.push('close');server.listening=false;queueMicrotask(()=>server.emit('close'));fn();};return server;}};
 return{events,routes,pools,releaseListener:()=>releaseListener(),deps:{pg:{Pool},express,TRPCError:class extends Error{},fs:f,http,process:{geteuid:()=>1234,getegid:()=>1234}}};
}
test('CLI and import stay unbound without package loads or host IO',()=>{
 const child=spawnSync(process.execPath,[path.join(__dirname,'upload-receiver.cjs')],{encoding:'utf8',env:{PATH:process.env.PATH,DATABASE_URL:'MUST_NOT_BE_USED',FS_SHARED_SECRET:'MUST_NOT_BE_USED'}});
 assert.equal(child.status,0);assert.deepEqual(JSON.parse(child.stdout),{status:'UNBOUND',hostIo:false,listening:false,productionBindingProvided:false});assert.equal(candidate.sourceBinding.runtimeBindingProvided,false);
 const f=fixture();assert.throws(()=>candidate.createUploadReceiver(JSON.parse(fs.readFileSync(path.join(__dirname,'PRIVATE-BINDING-UNBOUND.json'))),f.deps),/EXPLICIT_LISTENER_REQUIRED/);assert.deepEqual(f.events,[]);
});
test('requires explicit safe inputs before any dependency or pool use',()=>{
 for(const change of[b=>{b.port=null;},b=>{b.listenHost='public.invalid';},b=>{b.storage.path='/';},b=>{delete b.storage.uid;},b=>{delete b.processIdentity;},b=>{b.database.ca='disabled';},b=>{delete b.database.roleOid;},b=>{b.captureEnabled=false;},b=>{b.integrationSecret='placeholder';}]){const b=binding(),f=fixture();change(b);assert.throws(()=>candidate.createUploadReceiver(b,f.deps));assert.deepEqual(f.events,[]);}
});
test('registers only health and exact upload, with no global startup work',()=>{
 const f=fixture();const receiver=candidate.createUploadReceiver(binding(),f.deps);assert.deepEqual(f.routes.map(r=>[r.method,r.name]),[['POST','/upload'],['GET','/health'],['USE','/api/recordings']]);assert.deepEqual(f.events,['pool']);assert.equal(f.pools[0].config.ssl.rejectUnauthorized,true);assert.equal(f.pools[0].config.ssl.ca,binding().database.ca);assert.equal(f.pools[0].config.options,'-c search_path=pg_catalog,public,pg_temp');assert.equal(f.pools[0].config.connectionTimeoutMillis,5000);assert.equal(f.pools[0].config.query_timeout,undefined);return receiver.close();
});
test('awaits accepted restricted TLS identity and exact pins then storage before listen',async()=>{
 let release;const gate=new Promise(r=>release=r);const f=fixture({query:async(sql,args,n)=>{if(n===1){await gate;return{rows:[identity()]};}return{rows:[pins()]};}});const b=binding();const receiver=candidate.createUploadReceiver(b,f.deps);const starting=receiver.start();await new Promise(r=>setImmediate(r));assert(!f.events.includes('lstat'));assert(!f.events.includes('listen'));release();const result=await starting;assert.equal(result.restrictedTlsIdentityVerified,true);assert.equal(result.storageWriteAuthorizationProven,false);assert(f.events.indexOf('stat')<f.events.indexOf('listen'));assert.deepEqual(f.pools[0].last.args,[b.database.name,b.database.databaseOid,b.database.roleOid,b.database.serverVersion]);assert(f.pools[0].queries.every(q=>q.query_timeout===5000&&typeof q.text==='string'));await receiver.close();
});
test('false and NULL identity flags or pins refuse without listening',async()=>{
 for(const row of[{...identity(),tls:false},{...identity(),tls:null},{...identity(),restricted:false},{...identity(),no_ownership:false},{...identity(),no_memberships:false}]){const f=fixture({query:async()=>({rows:[row]})});const r=candidate.createUploadReceiver(binding(),f.deps);await assert.rejects(r.start(),/UPLOAD_RECEIVER_STARTUP_REFUSED/);assert(!f.events.includes('listen'));assert(f.events.includes('end'));}
 const f=fixture({query:async(sql,args,n)=>({rows:[n===1?identity():{...pins(),role_oid:false}]})});await assert.rejects(candidate.createUploadReceiver(binding(),f.deps).start(),/UPLOAD_RECEIVER_STARTUP_REFUSED/);assert(!f.events.includes('listen'));
});
test('DB failure stays private, and storage mismatch or symlink prevents listen',async()=>{
 for(const opts of[{query:async()=>{throw Error('PRIVATE_PASSWORD_MUST_NOT_ESCAPE');}},{metadata:{uid:0}},{metadata:{mode:0o40777}},{symlink:true}]){const f=fixture(opts);let error;try{await candidate.createUploadReceiver(binding(),f.deps).start();}catch(e){error=e;}assert.equal(error?.message,'UPLOAD_RECEIVER_STARTUP_REFUSED');assert(!JSON.stringify(error).includes('PRIVATE_PASSWORD'));assert(!f.events.includes('listen'));assert(f.events.includes('end'));}
});
test('health rechecks readiness and emits no identity/configuration values',async()=>{
 let unavailable=false;const f=fixture({query:async(sql)=>{if(unavailable)throw Error('PRIVATE_DB');return{rows:[sql.startsWith('SELECT current_user=')?identity():pins()]};}});const r=candidate.createUploadReceiver(binding(),f.deps),health=f.routes.find(x=>x.name==='/health').fn;const response=()=>({code:200,body:null,status(v){this.code=v;return this;},json(v){this.body=v;}});let res=response();await health({},res);assert.equal(res.code,503);await r.start();res=response();await health({},res);assert.deepEqual(res.body,{ok:true});unavailable=true;res=response();await health({},res);assert.equal(res.code,503);assert.deepEqual(res.body,{ok:false});await r.close();
});
test('private input changes cannot mutate the checked binding',async()=>{
 const f=fixture(),b=binding(),r=candidate.createUploadReceiver(b,f.deps);b.database.role='different';b.storage.uid=0;b.database.password='different';await r.start();assert.equal(f.pools[0].config.user,'owned_fixture_role');assert.equal(f.pools[0].config.password,'owned-fixture-password');await r.close();
});
test('exact derivative includes no broad router/bootstrap/provider source',()=>{
 const code=fs.readFileSync(path.join(__dirname,'upload-receiver.cjs'),'utf8');for(const forbidden of['startServer(','startRecordingCapture','startRecordingAnalysis','startRecordingRetention','startChatNotification','startChatMediaRetention','startEslListener','WebSocketServer','dotenv/config','/api/trpc','/api/auth','storageRouter.get(','storageRouter.post("/voicemail"'])assert(!code.includes(forbidden),forbidden);assert(code.includes("HAVING COUNT(DISTINCT cl.extension_id)=1"));assert(code.includes('async registerCall('));assert(code.includes('async recordingStored('));assert(!code.includes('async claimJob('));
});

test('startup refusal reports unknown cleanup without waiting indefinitely for pool.end',async()=>{
 const f=fixture({query:async()=>{throw Error('OWNED_READINESS_TIMEOUT');},neverEnd:true});const realSet=globalThis.setTimeout,realClear=globalThis.clearTimeout;let bounded=false;
 globalThis.setTimeout=(fn,ms)=>{assert.equal(ms,2000);bounded=true;queueMicrotask(fn);return 1;};globalThis.clearTimeout=()=>{};
 try{let error;try{await candidate.createUploadReceiver(binding(),f.deps).start();}catch(e){error=e;}assert.equal(error?.code,'UPLOAD_RECEIVER_STARTUP_REFUSED');assert.equal(error?.cleanupConfirmed,false);assert.equal(bounded,true);assert(!f.events.includes('listen'));}finally{globalThis.setTimeout=realSet;globalThis.clearTimeout=realClear;}
});

const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));
const resultOf=promise=>promise.then(value=>({value}),error=>({error}));
test('close during first readiness query cancels startup before later DB/storage/listener work',async()=>{
 let release;const waiting=new Promise(resolve=>release=resolve);const f=fixture({query:async(sql,args,n)=>n===1?waiting:{rows:[pins()]}}),r=candidate.createUploadReceiver(binding(),f.deps),started=resultOf(r.start());await nextTurn();const closing=r.close();release({rows:[identity()]});const outcome=await started;assert.equal(outcome.error?.code,'UPLOAD_RECEIVER_STARTUP_REFUSED');assert.equal(outcome.value,undefined);assert.equal((await closing).cleanupConfirmed,true);assert.equal(f.events.filter(v=>v==='query').length,1);assert(!f.events.includes('lstat'));assert(!f.events.includes('createServer'));assert(!f.events.includes('listening'));
});
test('close during storage metadata await prevents further metadata work and listener creation',async()=>{
 let release;const waiting=new Promise(resolve=>release=resolve);const f=fixture({lstat:()=>waiting}),r=candidate.createUploadReceiver(binding(),f.deps),started=resultOf(r.start());await nextTurn();assert(f.events.includes('lstat'));const closing=r.close();release({isSymbolicLink:()=>false});const outcome=await started;assert.equal(outcome.error?.code,'UPLOAD_RECEIVER_STARTUP_REFUSED');assert.equal(outcome.value,undefined);assert.equal((await closing).cleanupConfirmed,true);assert(!f.events.includes('realpath'));assert(!f.events.includes('createServer'));assert(!f.events.includes('listening'));
});
test('close during pending listener bind aborts it and cannot return LISTENING later',async()=>{
 const f=fixture({listenerPending:true}),r=candidate.createUploadReceiver(binding(),f.deps),started=resultOf(r.start());await nextTurn();assert(f.events.includes('listen'));assert(!f.events.includes('listening'));const closing=r.close();f.releaseListener();const outcome=await started;assert.equal(outcome.error?.code,'UPLOAD_RECEIVER_STARTUP_REFUSED');assert.equal(outcome.value,undefined);assert.equal((await closing).cleanupConfirmed,true);await nextTurn();assert(!f.events.includes('listening'));assert(f.events.includes('close'));
});
test('unsettled cancelled startup reports cleanup unknown and still cannot listen after it settles',async()=>{
 let release;const waiting=new Promise(resolve=>release=resolve);const f=fixture({lstat:()=>waiting}),r=candidate.createUploadReceiver(binding(),f.deps),started=resultOf(r.start());await nextTurn();const realSet=globalThis.setTimeout,realClear=globalThis.clearTimeout;globalThis.setTimeout=(fn,ms)=>{assert.equal(ms,2000);queueMicrotask(fn);return 1;};globalThis.clearTimeout=()=>{};let cleanup;
 try{cleanup=await r.close();}finally{globalThis.setTimeout=realSet;globalThis.clearTimeout=realClear;}
 assert.equal(cleanup.cleanupConfirmed,false);assert(!f.events.includes('end'));release({isSymbolicLink:()=>false});const outcome=await started;assert.equal(outcome.error?.cleanupConfirmed,false);await nextTurn();assert(!f.events.includes('listen'));assert(f.events.includes('end'));
});
test('local Node HTTP listener AbortSignal cancels a pending loopback bind',async()=>{
 const http=require('node:http'),server=http.createServer(),abort=new AbortController();let listening=false;server.once('listening',()=>{listening=true;});const closed=new Promise(resolve=>server.once('close',resolve));server.listen({port:0,host:'127.0.0.1',signal:abort.signal});abort.abort();await closed;await nextTurn();assert.equal(listening,false);assert.equal(server.listening,false);
});
