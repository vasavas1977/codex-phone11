'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),fs=require('node:fs'),path=require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const {once} = require('node:events');
const r=require('./runner.cjs'),c=r.constants;
const bytes=fs.readFileSync(path.resolve(__dirname,'../../.cache/phone11-worker-runtime/worker-bound.cjs'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function fixture(options={}){
 const p=new EventEmitter();p.geteuid=p.getegid=()=>1001;
 let state='prepared',starts=0,closes=0,prepared=0,closedFiles=0;const events=[],timers=new Map(),intervals=new Set();
 const runtime={status:()=>state,disposition:{capture:'enabled'},async start(){starts++;state='running';if(options.start)await options.start.promise;},async close(){closes++;if(options.close)await options.close.promise;state='closed';}};
 const parent={isDirectory:()=>true,isSymbolicLink:()=>false,uid:1001,gid:1001,mode:0o40700};
 const privateBytes=Buffer.from(JSON.stringify({version:'PHONE11_WORKER_PRIVATE_V1',worker:{}})+'\n');
 const metadata=(name)=>({isFile:()=>true,nlink:1,size:name===c.CONFIG?privateBytes.length:bytes.length,uid:1001,gid:1001,mode:name===c.CONFIG?0o100400:0o100444,dev:1,ino:name===c.CONFIG?2:3,mtimeMs:0,ctimeMs:0});
 const d={process:p,fs:{promises:{lstat:async name=>name===c.DIRECTORY?parent:metadata(name),realpath:async()=>c.DIRECTORY,open:async name=>({stat:async()=>metadata(name),read:async(buffer,offset,length,position)=>{const raw=name===c.CONFIG?privateBytes:bytes;return{bytesRead:raw.copy(buffer,offset,position,position+length)};},close:async()=>{closedFiles++;if(options.fileCloseError)throw Error();}})}},compile(){return{async prepareBoundWorkerRuntime(){prepared++;if(options.prepare)await options.prepare.promise;if(options.prepareError)throw Error(options.prepareError);return runtime;}};},setTimeout(fn,ms){const token={fn,ms};timers.set(token,token);return token;},clearTimeout(t){timers.delete(t);},setInterval(fn,ms){const token={fn,ms};intervals.add(token);return token;},clearInterval(t){intervals.delete(t);},emit:e=>events.push(e)};
 return{d,p,runtime,events,intervals,timers,fire(ms){const t=[...timers.values()].find(x=>x.ms===ms);assert(t);t.fn();},counts:()=>({starts,closes,prepared,closedFiles})};
}
test('ready retains liveness then one clean close on repeated signals',async()=>{const f=fixture(),done=r.run(f.d);await tick();assert.equal(f.events[0].status,'WORKER_READY');assert.equal(f.intervals.size,1);f.p.emit('SIGTERM');f.p.emit('SIGTERM');const v=await done;assert.equal(v.code,0);assert.equal(v.cleanupConfirmed,true);assert.equal(f.counts().closes,1);assert.equal(f.intervals.size,0);assert.equal(f.p.listenerCount('SIGTERM'),0);});
test('stop during preparation never starts eventual runtime',async()=>{const prep=deferred(),f=fixture({prepare:prep}),done=r.run(f.d);await tick();f.p.emit('SIGTERM');prep.resolve();assert.equal((await done).cleanupConfirmed,true);assert.equal(f.counts().starts,0);assert.equal(f.counts().closes,1);});
test('stop during active start closes once and waits settlement',async()=>{const start=deferred(),f=fixture({start}),done=r.run(f.d);await tick();f.p.emit('SIGTERM');await tick();assert.equal(f.counts().closes,1);assert.equal(f.events.length,0);start.resolve();assert.equal((await done).cleanupConfirmed,true);assert.equal(f.events[0].status,'WORKER_STOPPED');});
test('drain timeout quarantines alive and late success cannot upgrade',async()=>{const close=deferred(),f=fixture({close}),done=r.run(f.d);await tick();f.p.emit('SIGTERM');await tick();f.fire(c.STOP_MS);const v=await done;assert.equal(v.cleanupConfirmed,false);assert.equal(f.intervals.size,1);close.resolve();await tick();assert.equal(f.events.at(-1).status,'WORKER_STOP_UNCERTAIN');assert.equal(f.events.length,2);assert.equal(f.intervals.size,1);});
test('known setup refusal exits cleanly; unknown cleanup quarantines',async()=>{for(const message of ['WORKER_BOUND_SETUP_REFUSED','WORKER_BOUND_SETUP_CLEANUP_UNCONFIRMED','unexpected']){const f=fixture({prepareError:message}),v=await r.run(f.d);assert.equal(v.code,70);assert.equal(v.cleanupConfirmed,message==='WORKER_BOUND_SETUP_REFUSED');assert.equal(f.intervals.size,message==='WORKER_BOUND_SETUP_REFUSED'?0:1);assert.equal(f.counts().starts,0);}});
test('private descriptor close failure is unknown',async()=>{const f=fixture({fileCloseError:true}),v=await r.run(f.d);assert.equal(v.cleanupConfirmed,false);assert.equal(f.counts().prepared,0);assert.equal(f.intervals.size,1);});
test('startup timeout waits pending preparation, refuses late start',async()=>{const prep=deferred(),f=fixture({prepare:prep}),done=r.run(f.d);await tick();f.fire(c.STARTUP_MS);prep.resolve();const v=await done;assert.equal(v.cleanupConfirmed,true);assert.equal(v.code,70);assert.equal(f.counts().starts,0);assert.equal(f.counts().closes,1);});

test('import and unbound or malformed CLI invocations do not launch a worker', () => {
  const entry = require.resolve('./runner.cjs');
  const importOnly = spawnSync(process.execPath, ['-e', 'require(process.argv[1])', entry],
    {encoding: 'utf8', timeout: 5000});
  assert.equal(importOnly.status, 0);
  assert.equal(importOnly.stdout, '');
  assert.equal(importOnly.stderr, '');
  for (const [args, code] of [[[], 0], [['--run-bound-worker', 'extra'], 64]]) {
    const child = spawnSync(process.execPath, [entry, ...args], {encoding: 'utf8', timeout: 5000});
    assert.equal(child.status, code);
    assert.equal(child.stderr, '');
    assert.deepEqual(JSON.parse(child.stdout), {status: 'UNBOUND', hostIo: false, workersStarted: false});
  }
});

test('altered factory bytes refuse before compilation or actor setup', async () => {
  const f = fixture();
  const open = f.d.fs.promises.open;
  f.d.fs.promises.open = async (name, flags) => {
    const handle = await open(name, flags);
    if (name !== c.FACTORY) return handle;
    return {...handle, async read(buffer, offset, length, position) {
      const result = await handle.read(buffer, offset, length, position);
      buffer[offset] ^= 1;
      return result;
    }};
  };
  f.d.compile = () => assert.fail('unverified bytes reached compiler');
  assert.deepEqual(await r.run(f.d), {
    code: 70, status: 'WORKER_REFUSED', cleanupConfirmed: true, oldOwnerAbsenceProvenByRunner: false,
  });
  assert.equal(f.counts().prepared, 0);
  assert.equal(f.counts().starts, 0);
});

test('a replaced private binding path refuses before the factory is opened', async () => {
  const f = fixture();
  const lstat = f.d.fs.promises.lstat;
  f.d.fs.promises.lstat = async name => {
    const meta = await lstat(name);
    return name === c.CONFIG ? {...meta, ino: meta.ino + 1} : meta;
  };
  const result = await r.run(f.d);
  assert.equal(result.status, 'WORKER_REFUSED');
  assert.equal(result.cleanupConfirmed, true);
  assert.equal(f.counts().closedFiles, 1);
  assert.equal(f.counts().prepared, 0);
  assert.equal(f.counts().starts, 0);
});

const PIPE_FILL_BYTES = 1024 * 1024;

function launchBackpressuredChild(t, outcome) {
  const program = `
    const {EventEmitter} = require('node:events');
    const {runCli} = require(process.argv[1]);
    const lifecycle = new EventEmitter();
    lifecycle.geteuid = lifecycle.getegid = () => 0;
    if (process.stdout.write('x'.repeat(${PIPE_FILL_BYTES}) + '\\n')) {
      throw new Error('expected stdout backpressure');
    }
    void runCli({
      process: lifecycle, setTimeout, clearTimeout, setInterval, clearInterval,
      emit() { throw new Error('unexpected nonterminal result'); },
    });
    if (process.argv[2] === 'stop') lifecycle.emit('SIGTERM');
    setImmediate(() => process.stderr.write('terminal write pending\\n'));
  `;
  const child = spawn(process.execPath, ['-e', program, require.resolve('./runner.cjs'), outcome],
    {stdio: ['ignore', 'pipe', 'pipe']});
  child.stdout.pause();
  const exited = once(child, 'exit');
  const closed = once(child, 'close');
  const waiting = Promise.race([
    once(child.stderr, 'data').then(([message]) => {
      assert.equal(message.toString(), 'terminal write pending\n');
    }),
    exited.then(() => assert.fail('child exited before waiting for stdout')),
  ]);
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    child.stdout.destroy();
  });
  return {child, waiting, exited, closed};
}

for (const [outcome, code, status] of [
  ['refuse', 70, 'WORKER_REFUSED'],
  ['stop', 0, 'WORKER_STOPPED'],
]) {
  test(`the CLI writes the complete ${status} frame behind a backpressured OS pipe`, {timeout: 10000}, async t => {
    const {child, waiting, exited, closed} = launchBackpressuredChild(t, outcome);
    await waiting;
    const chunks = [];
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stdout.resume();
    assert.deepEqual(await exited, [code, null]);
    await closed;
    const output = Buffer.concat(chunks).toString();
    assert.equal(output.slice(0, PIPE_FILL_BYTES + 1), 'x'.repeat(PIPE_FILL_BYTES) + '\n');
    assert.equal(output.slice(PIPE_FILL_BYTES + 1), JSON.stringify({
      code, status, cleanupConfirmed: true, oldOwnerAbsenceProvenByRunner: false,
    }) + '\n');
  });
}

test('a broken terminal pipe exits nonzero even after known clean stop', {timeout: 10000}, async t => {
  const {child, waiting, exited} = launchBackpressuredChild(t, 'stop');
  await waiting;
  child.stdout.destroy();
  assert.deepEqual(await exited, [70, null]);
});

test('the CLI bounds a terminal write whose reader never drains', {timeout: c.TERMINAL_WRITE_MS + 5000}, async t => {
  const {waiting, exited} = launchBackpressuredChild(t, 'stop');
  await waiting;
  assert.deepEqual(await exited, [70, null]);
});
