const {test}=require('node:test'),assert=require('node:assert/strict'),{Buffer}=require('node:buffer'),path=require('node:path'),Module=require('node:module');
const {buildSync}=require('esbuild');
function load(file,external){
 const result=buildSync({entryPoints:[path.join(__dirname,file)],bundle:true,platform:'node',format:'cjs',packages:'external',write:false});
 const m=new Module(path.join(__dirname,'synthetic-unit.cjs'),module);m.filename=path.join(__dirname,'synthetic-unit.cjs');m.paths=module.paths;
 const original=Module._load;try{if(external)Module._load=function(name,...args){return name==='ioredis'?external:original.call(this,name,...args);};m._compile(Buffer.from(result.outputFiles[0].contents).toString(),m.filename);}finally{Module._load=original;}return m.exports;
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const tick=()=>new Promise(r=>setImmediate(r));
function services(events,pending,fail){
 const start=name=>()=>{events.push('start-'+name);if(fail===name)throw Error('PRIVATE_START');return async()=>{events.push('stop-'+name);if(pending)await pending;};};
 return {startChatNotificationDispatcher:start('chat'),startChatMediaRetention:start('media'),startRecordingAnalysis:start('analysis'),startRecordingRetention:start('retention'),startRecordingCapture:start('capture'),startFreeSwitchEventListener(){events.push('start-esl');if(fail==='esl')throw Error('PRIVATE_START');},async stopFreeSwitchEventListener(){events.push('stop-esl');if(pending)await pending;},shutdownWebSockets(){events.push('stop-ws');}};
}
test('actual lifecycle starts once, synchronously fences all stops, waits owned work before resources',async()=>{
 const {createWorkerLifecycle}=load('lifecycle.ts'),events=[],work=deferred();
 const life=createWorkerLifecycle(services(events,work.promise),async()=>events.push('resources'));
 await life.start();await assert.rejects(life.start(),{message:'WORKER_START_REFUSED'});
 const p=life.close();assert.equal(life.close(),p);assert.equal(life.status(),'closing');assert(!events.includes('resources'));assert(events.includes('stop-chat')&&events.includes('stop-esl'));
 work.resolve();await p;assert.equal(events.at(-1),'resources');assert.equal(life.status(),'closed');
});
test('partial actual background start unwinds already owned actors and terminally closes',async()=>{
 const {createWorkerLifecycle}=load('lifecycle.ts'),events=[];
 const life=createWorkerLifecycle(services(events,undefined,'capture'),async()=>events.push('resources'));
 await assert.rejects(life.start(),{message:'WORKER_START_REFUSED'});assert(events.includes('stop-chat')&&events.includes('stop-analysis'));assert.equal(events.at(-1),'resources');assert.equal(life.status(),'closed');
});
test('drain timeout stays unconfirmed and late settlement cannot close resources',async()=>{
 const {createWorkerLifecycle}=load('lifecycle.ts'),events=[],work=deferred();
 const life=createWorkerLifecycle(services(events,work.promise),async()=>events.push('resources'),10);await life.start();
 await assert.rejects(life.close(),{message:'WORKER_DRAIN_UNCONFIRMED'});work.resolve();await tick();assert.equal(life.status(),'unconfirmed');assert(!events.includes('resources'));
});
test('prepared close never starts and a resource failure remains sanitized/unconfirmed',async()=>{
 const {createWorkerLifecycle}=load('lifecycle.ts'),events=[];
 const life=createWorkerLifecycle(services(events),async()=>{throw Error('PRIVATE_CLOSE');});await assert.rejects(life.close(),{message:'WORKER_DRAIN_UNCONFIRMED'});assert.equal(events.length,0);assert.equal(life.status(),'unconfirmed');await assert.rejects(life.start(),{message:'WORKER_START_REFUSED'});
});
test('worker Redis is lazy, first concurrent publications share connection, close drains and blocks admission',async()=>{
 const {EventEmitter}=require('node:events'),connect=deferred(),send=deferred();let instance,connections=0;
 class Redis extends EventEmitter{
  constructor(url,options){super();this.url=url;this.options=options;this.status='wait';this.calls=[];instance=this;}
  connect(){connections++;this.status='connecting';return connect.promise.then(()=>{this.status='ready';});}
  publish(...args){this.calls.push(args);return send.promise;}
  disconnect(){this.status='end';this.emit('end');}
 }
 const m=load('owned-redis.ts',Redis);m.configureWorkerRedis('redis://owned-fixture.invalid:6379/0');assert.equal(instance,undefined);
 const a=m.getRedis().publish('pbx:events','owned-one'),b=m.getRedis().publish('pbx:events','owned-two');assert.equal(connections,1);assert.equal(instance.calls.length,0);
 connect.resolve();await tick();assert.equal(instance.calls.length,2);const closing=m.closeWorkerRedis();assert.throws(()=>m.getRedis(),{message:'WORKER_REDIS_UNAVAILABLE'});assert.notEqual(instance.status,'end');send.resolve(1);await Promise.all([a,b,closing]);assert.equal(instance.status,'end');assert.equal(m.closeWorkerRedis(),closing);
});

test('later new publication can reconnect after a settled connection failure; failed message is not replayed',async()=>{
 const {EventEmitter}=require('node:events');let connects=0,instance;
 class Redis extends EventEmitter{constructor(){super();this.status='wait';this.calls=[];instance=this;}
  connect(){connects++;if(connects===1){this.status='end';return Promise.reject(Error('PRIVATE_CONNECT'));}this.status='ready';return Promise.resolve();}
  publish(...args){this.calls.push(args);return Promise.resolve(1);}
  disconnect(){this.status='end';this.emit('end');}}
 const m=load('owned-redis.ts',Redis);m.configureWorkerRedis('redis://owned-fixture.invalid:6379/0');await assert.rejects(m.getRedis().publish('pbx:events','failed'));await tick();
 assert.equal(await m.getRedis().publish('pbx:events','new'),1);assert.equal(connects,2);assert.deepEqual(instance.calls,[['pbx:events','new']]);await m.closeWorkerRedis();
});
