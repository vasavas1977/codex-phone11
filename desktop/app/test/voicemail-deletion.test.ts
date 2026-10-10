import assert from 'node:assert/strict';
import {test} from 'node:test';
import {VoicemailDeletion} from '../src/voicemail-deletion';
function deferred<T>() {let resolve!:(value:T)=>void;let reject!:(e:Error)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});return {resolve,reject,promise};}
function fixture() {
 let scope:string|null='login:tenant9';let present=true;let stop=0;let changes=0;let calls=0;
 let response:()=>Promise<unknown>=async()=>({sessionRevision:'login',id:4,deleted:true});
 const owner=new VoicemailDeletion({currentScope:()=>scope,hasMessage:()=>present,stopPlayback:()=>{stop++;},changed:()=>{changes++;},remove:()=>{calls++;return response();}});
 return {owner,setScope:(s:string|null)=>{scope=s;},setPresent:(v:boolean)=>{present=v;},setResponse:(fn:()=>Promise<unknown>)=>{response=fn;},counts:()=>({stop,changes,calls})};
}
test('Cancel leaves row available; confirmed strict success retires row/playback',async()=>{
 const f=fixture();f.setResponse(async()=>({sessionRevision:'login',id:4,deleted:false}));await f.owner.run('login',4);
 assert.equal(f.counts().stop,1);assert.equal(f.owner.isRetired(4),false);assert.equal(f.owner.hasFailed(4),false);assert.equal(f.owner.isPending(4),false);
 f.setResponse(async()=>({sessionRevision:'login',id:4,deleted:true}));await f.owner.run('login',4);assert.equal(f.owner.isRetired(4),true);assert.equal(f.owner.canPlay(4),false);
 await f.owner.run('login',4);assert.equal(f.counts().calls,2);
});
test('pending state blocks duplicates and play before confirmation; failure offers retry',async()=>{
 const f=fixture();const gate=deferred<unknown>();f.setResponse(()=>gate.promise);const pending=f.owner.run('login',4);
 assert.equal(f.owner.isPending(4),true);assert.equal(f.owner.canPlay(4),false);await f.owner.run('login',4);assert.equal(f.counts().calls,1);
 gate.reject(new Error('PRIVATE'));await pending;assert.equal(f.owner.hasFailed(4),true);assert.equal(f.owner.isRetired(4),false);assert.equal(f.owner.canPlay(4),true);
 f.setResponse(async()=>({sessionRevision:'login',id:4,deleted:true}));await f.owner.run('login',4);assert.equal(f.owner.isRetired(4),true);
});
test('wrong ID/revision/coerced success/extra/unsupported replies never retire',async()=>{
 for(const value of [null,[],{sessionRevision:'old',id:4,deleted:true},{sessionRevision:'login',id:5,deleted:true},{sessionRevision:'login',id:4,deleted:1},{sessionRevision:'login',id:4,deleted:true,extra:'PRIVATE'},{success:true}]) {
  const f=fixture();f.setResponse(async()=>value);await f.owner.run('login',4);assert.equal(f.owner.hasFailed(4),true);assert.equal(f.owner.isRetired(4),false);
 }
});
test('account/tenant/sign-out replacement retires late success and failure without touching replacement row',async()=>{
 for(const scope of ['other:tenant9','login:tenant12',null]) for(const fails of [true,false]) {
  const f=fixture();const gate=deferred<unknown>();f.setResponse(()=>gate.promise);const pending=f.owner.run('login',4);f.setScope(scope);f.owner.sync();
  if(fails)gate.reject(new Error('PRIVATE'));else gate.resolve({sessionRevision:'login',id:4,deleted:true});await pending;
  assert.equal(f.owner.isRetired(4),false);assert.equal(f.owner.isPending(4),false);assert.equal(f.owner.hasFailed(4),false);
 }
});
test('absent/invalid rows cannot enter privileged method; deletion-start retires prior read version',async()=>{
 const f=fixture();f.setPresent(false);await f.owner.run('login',4);assert.equal(f.counts().calls,0);f.setPresent(true);
 for(const id of [0,-1,NaN,1.5])await f.owner.run('login',id);assert.equal(f.counts().calls,0);
 const version=f.owner.version;await f.owner.run('login',4);assert.notEqual(f.owner.version,version);
});
