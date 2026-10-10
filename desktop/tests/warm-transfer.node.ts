import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopCallBoundary, HelperCommandRejectedError, type HelperCommand, type DesktopSession } from '../src/call-boundary';
const session: DesktopSession = { revision:'session',userId:'user',tenantId:1,extensionId:1,accountId:'account' };
const request = '12345678-1234-4234-8234-123456789abc';
function setup(enabled=true) {
  const commands: HelperCommand[]=[];
  let reject: Error | null=null;
  const boundary = new DesktopCallBoundary({ execute:async command => { commands.push(command); if(reject)throw reject; } },25);
  boundary.startHelperGeneration('generation'); boundary.bindSession(session,'generation'); boundary.setWarmCapability(enabled);
  let sequence=0;
  const event=(data:object, extra:object={})=>boundary.receiveHelperEvent({version:1,generation:'generation',sessionRevision:'session',accountId:'account',sequence:++sequence,...data,...extra});
  event({type:'registration',registered:true});event({type:'call',callId:'200',state:'connected'});
  const action=(operation:string,extra:object={})=>boundary.handleRendererAction({operation,sessionRevision:'session',generation:'generation',callId:'200',...extra},session);
  const warm=(phase:string,extra:object={})=>event({type:'consultation',callId:'200',requestId:commands[0]?.requestId??request,consultId:null,originalAlive:true,consultConnected:false,phase,...extra});
  return {boundary,commands,event,action,warm,setReject:(error:Error|null)=>{reject=error;}};
}

test('warm unavailable by default and ordinary call is retained',async()=>{
  const x=setup(false); await assert.rejects(x.action('consult',{destination:'1021'})); assert.equal(x.commands.length,0);
  await x.action('end');assert.equal(x.commands[0].operation,'end');x.boundary.clear();
});
test('one consultation attempt with native request ownership and authenticated ordered continuation',async()=>{
  const x=setup();await x.action('consult',{destination:'1021'});const owned=x.commands[0].requestId;
  assert.match(owned!,/^[0-9a-f-]{36}$/);await assert.rejects(x.action('consult',{destination:'1022'}));
  assert.equal(x.warm('held_ready',{requestId:request}),false);assert.equal(x.commands.length,1);
  x.event({type:'call',callId:'200',state:'held'});
  assert.equal(x.warm('held_ready'),true);await Promise.resolve();assert.equal(x.commands[1].warmOperation,'continue');
  x.warm('held_ready');assert.equal(x.commands.length,2);
  x.warm('focus_ready',{consultId:'201',consultConnected:true});await Promise.resolve();assert.equal(x.commands[2].warmOperation,'focus');
  x.warm('focused',{consultId:'201',consultConnected:true});await Promise.resolve();assert.equal(x.commands[3].warmOperation,'unmute');
  x.warm('ready',{consultId:'201',consultConnected:true});
  await assert.rejects(x.action('transfer',{destination:'1022'}));await assert.rejects(x.action('hold',{value:false}));
  await x.action('consult-complete',{requestId:owned});assert.equal(x.commands[4].warmOperation,'complete');
  await assert.rejects(x.action('consult-complete',{requestId:owned}));
  x.warm('transfer_failed',{consultId:'201',consultConnected:true});await x.action('consult-cancel',{requestId:owned});
  x.warm('return_ready');await Promise.resolve();assert.equal(x.commands.at(-1)?.warmOperation,'restore');
  x.event({type:'call',callId:'200',state:'connected'});x.warm('return_audio_ready');await Promise.resolve();assert.equal(x.commands.filter(c=>c.warmOperation==='restore').length,2);
  x.warm('returned');assert.equal(x.boundary.snapshot().consultation?.phase,'returned');x.boundary.clear();
});
test('wrong generation/account/request and retired consult cannot advance or revive',async()=>{
  const x=setup();await x.action('consult',{destination:'1021'});
  assert.equal(x.event({type:'consultation',callId:'200',requestId:x.commands[0].requestId,consultId:null,originalAlive:true,consultConnected:false,phase:'held_ready'},{accountId:'other'}),false);
  x.warm('calling',{consultId:'201'});x.warm('return_ready');
  assert.equal(x.warm('ready',{consultId:'201',consultConnected:true}),false);
  assert.equal(x.warm('ready',{consultId:'202',consultConnected:true}),false);x.boundary.clear();
});
test('logout and changed account prevent late callbacks/continuations and old renderer commands',async()=>{
  const x=setup();await x.action('consult',{destination:'1021'});x.boundary.clear();assert.equal(x.warm('held_ready'),false);
  await assert.rejects(x.action('consult-cancel',{requestId:x.commands[0].requestId}));assert.equal(x.commands.length,1);
  x.boundary.startHelperGeneration('next');x.boundary.bindSession({...session,revision:'next-session',accountId:'other'},'next');assert.equal(x.warm('held_ready'),false);
  x.boundary.clear();
});
test('original termination preserves sole consult End; definite refusal permits retry and late IDs stay retired',async()=>{
  const x=setup();await x.action('consult',{destination:'1021'});x.warm('ready',{consultId:'201',consultConnected:true});
  x.event({type:'call',callId:'200',state:'terminated'});x.warm('original_ended',{consultId:'201',originalAlive:false,consultConnected:true});
  assert.equal(x.boundary.snapshot().call?.id,'201');assert.equal(x.warm('held_ready',{originalAlive:true}),false);await assert.rejects(x.action('dial',{destination:'1022'}));
  x.setReject(new HelperCommandRejectedError());await assert.rejects(x.action('end',{callId:'201'}));x.setReject(null);await x.action('end',{callId:'201'});
  await assert.rejects(x.action('end',{callId:'201'}));x.warm('ended',{originalAlive:false});
  assert.equal(x.boundary.snapshot().call,null);assert.equal(x.warm('original_ended',{consultId:'201',originalAlive:false}),false);x.boundary.clear();
});
test('missing focus/transfer callbacks become uncertain while explicit End remains',async()=>{
  const x=setup();await x.action('consult',{destination:'1021'});x.warm('calling',{consultId:'201'});
  await new Promise(resolve=>setTimeout(resolve,40));assert.equal(x.boundary.snapshot().consultation?.phase,'uncertain');
  await assert.rejects(x.action('consult-cancel',{requestId:x.commands[0].requestId}));await x.action('end',{callId:'201'});x.boundary.clear();
});


test('cancel removes local hold and restores focus even when authoritative remote hold remains',async()=>{
  const x=setup();await x.action('consult',{destination:'1021'});
  x.event({type:'call',callId:'200',state:'held'});x.warm('ready',{consultId:'201',consultConnected:true});
  await x.action('consult-cancel',{requestId:x.commands[0].requestId});x.warm('return_ready');await Promise.resolve();
  assert.equal(x.commands.filter(c=>c.warmOperation==='restore').length,1);
  x.warm('returning');x.event({type:'call',callId:'200',state:'held'}); // Remote hold persists after local hold is removed.
  x.warm('return_audio_ready');await Promise.resolve();assert.equal(x.commands.filter(c=>c.warmOperation==='restore').length,2);
  x.warm('return_audio_ready');assert.equal(x.commands.filter(c=>c.warmOperation==='restore').length,2);
  x.warm('returned');assert.equal(x.boundary.snapshot().call?.state,'held');x.boundary.clear();
});
