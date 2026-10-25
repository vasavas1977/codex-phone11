const {test}=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module'),{rootCertificates}=require('node:tls');
const realLoad=Module._load;let shared;
class Client{}
class Pool{
 constructor(config){shared.configs.push(config);}
 on(){}
 async end(){shared.ended++;if(shared.failEnd)throw Error('PRIVATE_POOL_END');}
 async connect(){return {query:async config=>{shared.queries.push(config);if(shared.queryHook)await shared.queryHook(config);const text=typeof config==='string'?config:config.text;if(text.includes('current_user=$1'))return{rows:[shared.identity]};if(text.includes('approved_chat_scope'))return{rows:[shared.schema]};if(shared.pendingWork)await shared.pendingWork;return{rows:[]};},release(value){shared.released.push(value);}};}
 async query(config){const c=await this.connect();try{return await c.query(config);}finally{c.release();}}
}
const predicates=['identity','role_oid','database','flags','login','tls','addresses','isolation','path','statement','lock','idle','application','membership','ownership','ddl'];
const envKeys=['NODE_ENV','PHONE11_CHAT_NOTIFICATIONS_ENABLED','PHONE11_RECORDING_AI_ENABLED','PHONE11_RECORDING_RETENTION_ENABLED','PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED','RECORDINGS_PATH','PHONE11_CHAT_MEDIA_PATH','PHONE11_PROFILE_PHOTO_CLEANUP_EXTERNAL','APNS_KEY_PATH','APNS_KEY_ID','APNS_TEAM_ID','APNS_BUNDLE_ID','APNS_ENVIRONMENT','GEMINI_API_KEY','PHONE11_RECORDING_GEMINI_MODEL','PHONE11_RECORDING_ESL_HOST','PHONE11_RECORDING_ESL_PORT','PHONE11_RECORDING_ESL_PASSWORD','PHONE11_RECORDING_ANNOUNCEMENT_PATH','PHONE11_RECORDING_SPOOL_PATH','PHONE11_RECORDING_UPLOAD_URL','FS_SHARED_SECRET','FREESWITCH_ESL_HOST','FREESWITCH_ESL_PORT','FREESWITCH_ESL_PASSWORD','FS_ESL_HOST','FS_ESL_PORT','FS_ESL_PASSWORD'];
Module._load=function(name,...args){if(name==='pg')return{Client,Pool};if(name==='pg/lib/client.js')return Client;if(name==='better-auth')return{betterAuth(){throw Error('AUTH_MUST_NOT_CONSTRUCT');}};return realLoad.call(this,name,...args);};
function reset(){for(const k of envKeys)delete process.env[k];shared={configs:[],queries:[],released:[],ended:0,identity:Object.fromEntries(predicates.map(k=>[k,true])),schema:{approved_chat_scope:true,retention_schema:true,capture_schema:true,cloud_star_select:true}};const f=require.resolve('../../.cache/phone11-worker-runtime/worker-bound.cjs');delete require.cache[f];return require(f);}
const binding=()=>({database:{host:'postgres',port:5432,database:'phone11ai',user:'phone11_worker_candidate',password:'PRIVATE_SYNTHETIC_PASSWORD',tlsCaPem:rootCertificates[0]},databaseAuthority:{roleOid:12345,databaseOid:54321,clientAddress:'127.0.0.1',serverAddress:'127.0.0.1',serverPort:5432},enabled:{chatNotifications:false,chatMediaRetention:false,recordingAnalysis:false,recordingRetention:false,eslEvents:false},capture:{mode:'off'}});
test('import inert; disabled providers absent; prepare only attests same owned graph and no worker starts',async()=>{
 const m=reset();assert.equal(shared.configs.length,0);assert.deepEqual(Object.keys(m),['prepareBoundWorkerRuntime']);const c=await m.prepareBoundWorkerRuntime(binding());assert.equal(c.status(),'prepared');assert.equal(shared.configs.length,1);assert.equal(shared.queries.length,2);assert.equal(shared.configs[0].ssl.rejectUnauthorized,true);assert.equal(process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED,'false');assert.equal(c.disposition.capture,'off');await c.close();assert.equal(c.status(),'closed');assert.equal(shared.ended,1);await assert.rejects(c.start(),{message:'WORKER_START_REFUSED'});
});
test('wrong same-pool predicate refuses before schema/import/start and closes only owned pool',async()=>{
 const m=reset();shared.identity.tls=false;await assert.rejects(m.prepareBoundWorkerRuntime(binding()),{message:'WORKER_BOUND_SETUP_REFUSED'});assert.equal(shared.queries.length,1);assert.equal(shared.ended,1);assert.deepEqual(shared.released,[true]);
});
test('schema/grant refusal is pre-start and does not read provider keys or construct capture',async()=>{
 const m=reset();shared.schema.capture_schema=false;await assert.rejects(m.prepareBoundWorkerRuntime(binding()),{message:'WORKER_BOUND_SETUP_REFUSED'});assert.equal(shared.ended,1);assert.equal(shared.queries.length,2);
});
test('invalid selected config fails before pool; disabled actors do not require private provider fields',async()=>{
 let m=reset(),b=binding();b.enabled.recordingAnalysis=true;await assert.rejects(m.prepareBoundWorkerRuntime(b),{message:'WORKER_BOUND_SETUP_REFUSED'});assert.equal(shared.configs.length,0);
 m=reset();b=binding();b.capture.mode='cleanup-only';await assert.rejects(m.prepareBoundWorkerRuntime(b),{message:'WORKER_BOUND_SETUP_REFUSED'});assert.equal(shared.configs.length,0);
});
test('actual maintained chat retention drains active SQL before resource close; profile cleanup remains external',async()=>{
 const m=reset(),b=binding();b.enabled.chatMediaRetention=true;b.chatMediaPath='/owned/synthetic/chat';const c=await m.prepareBoundWorkerRuntime(b);let finish;shared.pendingWork=new Promise(r=>{finish=r;});await c.start();assert.equal(process.env.PHONE11_PROFILE_PHOTO_CLEANUP_EXTERNAL,'1');const closed=c.close();assert.equal(shared.ended,0);finish();await closed;assert.equal(shared.ended,1);assert(shared.queries.some(q=>typeof q==='string'&&q.includes('phone11_chat_attachments')));assert(!shared.queries.some(q=>String(q).includes('profile_photo')));
});
test('resource closure failure remains finite terminal and sanitized',async()=>{
 const m=reset(),c=await m.prepareBoundWorkerRuntime(binding());shared.failEnd=true;await assert.rejects(c.close(),{message:'WORKER_DRAIN_UNCONFIRMED'});assert.equal(c.status(),'unconfirmed');assert.equal(shared.ended,1);await assert.rejects(m.prepareBoundWorkerRuntime(binding()),{message:'WORKER_BOUND_SETUP_REFUSED'});
});

test('private binding is copied before async attestation; analysis-only selects cloud gate without enabling retention/capture',async()=>{
 const m=reset(),b=binding();b.enabled.recordingAnalysis=true;b.recordingsPath='/owned/synthetic/recordings';b.analysis={apiKey:'SYNTHETIC_PROVIDER_KEY',model:'synthetic-model'};
 shared.queryHook=async config=>{if(config.text?.includes('current_user=$1')){b.database.user='mutated';b.enabled.recordingRetention=true;b.capture.mode='enabled';b.analysis.model='mutated';}};
 const c=await m.prepareBoundWorkerRuntime(b);assert.deepEqual(shared.queries[1].values,[false,false,false,true]);assert.equal(c.disposition.recordingAnalysis,true);assert.equal(c.disposition.recordingRetention,false);assert.equal(c.disposition.capture,'off');assert.equal(process.env.PHONE11_RECORDING_GEMINI_MODEL,'synthetic-model');assert.equal(shared.configs[0].user,'phone11_worker_candidate');await c.close();
});

test('selected capture env drift during awaited readiness refuses before configuration caching or native start',async()=>{
 const m=reset(),b=binding();b.capture={mode:'cleanup-only',host:'bound.invalid',port:8021,password:'PRIVATE_SYNTHETIC_ESL',announcementPath:'/owned/announcement.wav',spoolPath:'/owned/spool',uploadUrl:'https://upload.invalid/api/recordings/upload',integrationSecret:'PRIVATE_SYNTHETIC_INTEGRATION_64'};
 shared.queryHook=async config=>{if(config.text?.includes('current_user=$1'))process.env.PHONE11_RECORDING_ESL_HOST='drifted.invalid';};
 await assert.rejects(m.prepareBoundWorkerRuntime(b),{message:'WORKER_BOUND_SETUP_REFUSED'});assert.equal(shared.queries.length,1);assert.equal(shared.ended,1);assert.equal(process.env.PHONE11_RECORDING_ESL_HOST,'drifted.invalid');
});
