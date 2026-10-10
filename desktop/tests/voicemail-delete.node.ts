import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthenticatedDesktopProvider } from '../src/authenticated-provider';
const trpc = (json: unknown, status=200) => new Response(JSON.stringify({result:{data:{json}}}),{status});
const row = {id:4,tenant_id:9,status:'new',duration_seconds:1,created_at:'2026-10-09T00:00:00Z'};
function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve}; }
async function fixture() {
  const calls: string[]=[]; let tenant=9; let user=7;
  let list: ()=>Promise<Response> = async()=>trpc([row]);
  let mutation: ()=>Promise<Response> = async()=>trpc({success:true});
  let read: ()=>Promise<Response> = async()=>trpc({success:true});
  let media: ()=>Promise<Response> = async()=>new Response(new Uint8Array([82,73,70,70,0,0,0,0,87,65,86,69]),{headers:{'content-type':'audio/wav'}});
  const provider=new AuthenticatedDesktopProvider({origin:'https://phone11.example.test',fetch:async(input,init)=>{
    const url=new URL(String(input)); calls.push(url.pathname);
    if(url.pathname==='/api/auth/sign-in/email')return new Response('{"success":true}',{headers:{'set-auth-token':'test-only-token'}});
    if(url.pathname==='/api/auth/me')return new Response(JSON.stringify({user:{id:user}}));
    if(url.pathname==='/api/trpc/pbx.memberships')return trpc([{tenantId:tenant,tenantName:'Test',tenantStatus:'active'}]);
    if(url.pathname==='/api/trpc/phone.getConfig')return trpc({configured:true,tenantId:tenant,extension:{id:41,number:'1020'},sip:{username:'test',password:'test-only',domain:'sip.example.test',transport:'TLS'}});
    if(url.pathname==='/api/trpc/pbx.voicemail.list') {
      assert.deepEqual(JSON.parse(url.searchParams.get('input')!),{json:{tenantId:tenant}});return list();
    }
    if(url.pathname==='/api/trpc/pbx.voicemail.delete') {
      assert.equal(init?.method,'POST');assert.equal(init?.redirect,'error');assert.equal(init?.credentials,'omit');assert.equal(init?.cache,'no-store');
      assert.deepEqual(JSON.parse(String(init?.body)),{json:{tenantId:tenant,id:4}});return mutation();
    }
    if(url.pathname==='/api/trpc/pbx.voicemail.markRead')return read();
    if(url.pathname==='/api/recordings/voicemail/4')return media();
    if(url.pathname==='/api/auth/sign-out')return new Response('{}');
    throw new Error('UNEXPECTED_TEST_PATH');
  }});
  const login=async()=>{const s=await provider.signIn('user@example.test','test-only');if('selectionRevision' in s)throw new Error('TEST_SCOPE');return s;};
  const session=await login();
  return {provider,session,calls,login,setOwner:(t:number,u:number)=>{tenant=t;user=u;},setList:(v:()=>Promise<Response>)=>{list=v;},setMutation:(v:()=>Promise<Response>)=>{mutation=v;},setRead:(v:()=>Promise<Response>)=>{read=v;},setMedia:(v:()=>Promise<Response>)=>{media=v;}};
}
const mutations=(calls:string[])=>calls.filter(p=>p.endsWith('voicemail.delete')).length;
test('delete requires explicit privileged confirmation, valid ID, fresh owned inbox and fixed selected-tenant RPC',async()=>{
 const f=await fixture();
 await assert.rejects(f.provider.deleteVoicemail(f.session.revision,4,false));
 for(const id of [0,-1,1.5,Number.NaN])await assert.rejects(f.provider.deleteVoicemail(f.session.revision,id,true));
 await assert.rejects(f.provider.deleteVoicemail('old',4,true));assert.equal(mutations(f.calls),0);
 await f.provider.deleteVoicemail(f.session.revision,4,true);assert.equal(mutations(f.calls),1);
 assert.deepEqual(await f.provider.listVoicemail(f.session.revision),[]);
 await assert.rejects(f.provider.deleteVoicemail(f.session.revision,4,true));
 await assert.rejects(f.provider.voicemailAudio(f.session.revision,4));await assert.rejects(f.provider.markVoicemailRead(f.session.revision,4));assert.equal(mutations(f.calls),1);
});
test('foreign, deleted, missing-tenant, duplicate and absent rows refuse before mutation',async()=>{
 for(const rows of [[],[{...row,id:5}],[{...row,tenant_id:10}],[{...row,tenant_id:undefined}],[{...row,status:'deleted'}],[row,row]]) {
  const f=await fixture();f.setList(async()=>trpc(rows));await assert.rejects(f.provider.deleteVoicemail(f.session.revision,4,true));assert.equal(mutations(f.calls),0);
 }
});
test('strict success decoding refuses false/coerced/extra/unknown/error/unsupported and permits an explicit later retry',async()=>{
 for(const response of [trpc({success:false}),trpc({success:1}),trpc({success:true,id:4}),trpc(null),new Response('{"unknown":"PRIVATE"}'),trpc({success:true},404),trpc({success:true},503),trpc({success:true},201),new Response('{"error":"PRIVATE","result":{"data":{"json":{"success":true}}}}')]) {
  const f=await fixture();f.setMutation(async()=>response);await assert.rejects(f.provider.deleteVoicemail(f.session.revision,4,true),e=>e instanceof Error&&!e.message.includes('PRIVATE')&&!('cause' in e));
  f.setMutation(async()=>trpc({success:true}));await f.provider.deleteVoicemail(f.session.revision,4,true);assert.equal(mutations(f.calls),2);
 }
 const f=await fixture();f.setMutation(async()=>{throw new Error('PRIVATE_TRANSPORT');});await assert.rejects(f.provider.deleteVoicemail(f.session.revision,4,true));
 f.setMutation(async()=>trpc({success:true}));await f.provider.deleteVoicemail(f.session.revision,4,true);
});
test('account/workspace replacement during fresh inbox sends no destructive request',async()=>{
 for(const replacement of [[9,8],[12,7]]) {
  const f=await fixture();const gate=deferred<Response>();f.setList(()=>gate.promise);
  const pending=f.provider.deleteVoicemail(f.session.revision,4,true);const rejected=assert.rejects(pending);
  f.setOwner(replacement[0],replacement[1]);await f.login();gate.resolve(trpc([row]));await rejected;assert.equal(mutations(f.calls),0);
 }
});
test('late delete success cannot retire same ID in replacement account',async()=>{
 const f=await fixture();const gate=deferred<Response>();const entered=deferred<void>();f.setMutation(()=>{entered.resolve();return gate.promise;});
 const pending=f.provider.deleteVoicemail(f.session.revision,4,true);const rejected=assert.rejects(pending);await entered.promise;
 f.setOwner(9,8);const newer=await f.login();gate.resolve(trpc({success:true}));await rejected;
 assert.equal((await f.provider.listVoicemail(newer.revision))[0].id,4);
});
test('pending delete blocks duplicate/play/read; late pre-delete read/list/audio cannot revive message',async()=>{
 for(const kind of ['list','read','audio']) {
  const f=await fixture();const gate=deferred<Response>();const entered=deferred<void>();
  if(kind==='list')f.setList(()=>{entered.resolve();return gate.promise;});
  if(kind==='read')f.setRead(()=>{entered.resolve();return gate.promise;});
  if(kind==='audio')f.setMedia(()=>{entered.resolve();return gate.promise;});
  const pending=kind==='list'?f.provider.listVoicemail(f.session.revision):kind==='read'?f.provider.markVoicemailRead(f.session.revision,4):f.provider.voicemailAudio(f.session.revision,4);
  const rejected=assert.rejects(pending);await entered.promise;f.setList(async()=>trpc([row]));
  const deleting=deferred<Response>();const deleteEntered=deferred<void>();f.setMutation(()=>{deleteEntered.resolve();return deleting.promise;});
  const remove=f.provider.deleteVoicemail(f.session.revision,4,true);await deleteEntered.promise;
  await assert.rejects(f.provider.deleteVoicemail(f.session.revision,4,true));await assert.rejects(f.provider.markVoicemailRead(f.session.revision,4));await assert.rejects(f.provider.voicemailAudio(f.session.revision,4));
  deleting.resolve(trpc({success:true}));await remove;
  gate.resolve(kind==='audio'?new Response(new Uint8Array([82,73,70,70,0,0,0,0,87,65,86,69]),{headers:{'content-type':'audio/wav'}}):kind==='list'?trpc([row]):trpc({success:true}));
  await rejected;assert.deepEqual(await f.provider.listVoicemail(f.session.revision),[]);assert.equal(mutations(f.calls),1);
 }
});

test('delete reply body is bounded and aborted through session replacement or timeout, never success',async()=>{
 for(const kind of ['replacement','timeout','oversize']) {
  const f=await fixture();const entered=deferred<void>();let cancelled=false;
  f.setMutation(async()=>{
   const stream=new ReadableStream<Uint8Array>({start(c){entered.resolve();if(kind==='oversize'){c.enqueue(new Uint8Array(65537));c.close();}},cancel(){cancelled=true;}});
   return new Response(stream);
  });
  const original=globalThis.setTimeout;
  if(kind==='timeout')globalThis.setTimeout=((fn:()=>void,ms:number)=>original(fn,ms===15000?1:ms)) as typeof setTimeout;
  try {
   const pending=f.provider.deleteVoicemail(f.session.revision,4,true);const rejected=assert.rejects(pending);await entered.promise;
   if(kind==='replacement'){f.setOwner(9,8);await f.login();}
   await rejected;if(kind!=='oversize')assert.equal(cancelled,true);
  } finally {globalThis.setTimeout=original;}
 }
});

test('destructive fresh inbox body is deadline/byte bounded, cancelled and retryable without mutation',async()=>{
 for(const kind of ['timeout','replacement','oversize','body-error']) {
  const f=await fixture();const entered=deferred<void>();let cancelled=false;
  f.setList(async()=>new Response(new ReadableStream<Uint8Array>({
   start(c){entered.resolve();if(kind==='oversize')c.enqueue(new Uint8Array(65537));if(kind==='body-error')c.error(new Error('PRIVATE_BODY'));},
   cancel(){cancelled=true;},
  })));
  const original=globalThis.setTimeout;
  if(kind==='timeout')globalThis.setTimeout=((fn:()=>void,ms:number)=>original(fn,ms===15000?5:ms)) as typeof setTimeout;
  let current=f.session;
  try {
   const pending=f.provider.deleteVoicemail(f.session.revision,4,true);
   const rejected=assert.rejects(pending,e=>e instanceof Error&&!e.message.includes('PRIVATE')&&!('cause' in e));
   await entered.promise;
   if(kind==='replacement'){f.setOwner(9,8);current=await f.login();}
   await rejected;assert.equal(mutations(f.calls),0);
   if(kind!=='body-error')assert.equal(cancelled,true);
  } finally {globalThis.setTimeout=original;}
  f.setList(async()=>trpc([row]));await f.provider.deleteVoicemail(current.revision,4,true);
  assert.equal(mutations(f.calls),1);
 }
});

test('destructive inbox preflight rejects unsupported HTTP status and nonexact envelopes before mutation',async()=>{
 for(const response of [trpc([row],201),trpc([row],404),new Response('{"result":{"data":{"json":[]}},"error":"PRIVATE"}'),new Response('{"result":{"data":{"json":[],"extra":true}}}'),new Response('{"result":{"data":{"json":[]},"extra":true}}')]) {
  const f=await fixture();f.setList(async()=>response);
  await assert.rejects(f.provider.deleteVoicemail(f.session.revision,4,true));assert.equal(mutations(f.calls),0);
 }
});
