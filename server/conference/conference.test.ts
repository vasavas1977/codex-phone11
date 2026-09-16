import { describe,it,expect,vi } from 'vitest';
import { createConferenceService, type ConferenceProvider, type ConferenceRepository } from './service';
import { createConferenceRepository } from './repository';
import { createProvisionedConferenceProvider,parseConferenceSnapshot } from './provider';
import { createConferenceEsl } from './esl';
const scope={tenantId:7,userId:2};
const row={id:'fbeff209-512a-4c78-9ea2-877eb20d4d7f',provider_room:'p11_t7_meeting',created_by:2,created_at:new Date(0),can_moderate:true};
const observed={conference_name:row.provider_room,running:true,recording:false,locked:false,run_time:20,members:[{type:'caller',id:8,caller_id_name:'Alice',caller_id_number:'1001',join_time:10,flags:{can_speak:true,hold:false,talking:false,is_moderator:true}}]};
const body=()=>JSON.stringify([observed]);
const snapshot=()=>parseConferenceSnapshot(body(),row,100000);
function repo():ConferenceRepository{return {scope:vi.fn(async()=>scope),assertRoom:vi.fn(async()=>{}),once:vi.fn(async(_s,_k,_o,run)=>run())};}
function provider():ConferenceProvider{return {available:vi.fn(async()=>true),list:vi.fn(async()=>[snapshot()]),detail:vi.fn(async()=>snapshot()),execute:vi.fn(async()=>snapshot())};}
const op={type:'action',conferenceId:row.id,action:{type:'mute_all'}} as const;
const key='request_1234567890';
describe('conference authority',()=>{
 it('fails closed without provider and advertises no media',async()=>{const service=createConferenceService(repo());expect(await service.capabilities(2)).toMatchObject({audioAvailable:false,videoAvailable:false,createAvailable:false,joinAvailable:false});await expect(service.execute(2,key,op)).rejects.toMatchObject({code:'PRECONDITION_FAILED'});await expect(service.list(2)).rejects.toThrow();});
 it('checks authorization before idempotency or provider effect',async()=>{const r=repo(),p=provider();vi.mocked(r.assertRoom).mockRejectedValue(new Error('Forbidden'));await expect(createConferenceService(r,p).execute(2,key,op)).rejects.toThrow('Forbidden');expect(r.once).not.toHaveBeenCalled();expect(p.execute).not.toHaveBeenCalled();});
 it('never enables create/invite/video on audio provider',async()=>{const p=provider(),s=createConferenceService(repo(),p);expect(await s.capabilities(2)).toMatchObject({audioAvailable:true,createAvailable:false,inviteAvailable:false,videoAvailable:false});await expect(s.execute(2,key,{type:'create',name:'test'})).rejects.toThrow();expect(p.execute).not.toHaveBeenCalled();});
 it('propagates provider failures without synthesizing success',async()=>{const p=provider();vi.mocked(p.execute).mockRejectedValue(new Error('ESL down'));await expect(createConferenceService(repo(),p).execute(2,key,op)).rejects.toThrow('ESL down');});
 it('rejects unsupported recording and role changes',async()=>{const p=provider(),s=createConferenceService(repo(),p);await expect(s.execute(2,key,{...op,action:{type:'start_recording'}})).rejects.toThrow();expect(p.execute).not.toHaveBeenCalled();});
 it('requires a connected provider probe',async()=>{const p=provider();vi.mocked(p.available).mockResolvedValue(false);expect((await createConferenceService(repo(),p).capabilities(2)).audioAvailable).toBe(false);});
});
describe('observed FreeSWITCH rooms',()=>{
 it('uses real member ID/status without synthesized self/join',()=>{expect(snapshot()).toMatchObject({joinAvailable:false,canManage:true,bridgeNumber:'',participants:[{id:'8',name:'Alice',joinedAt:90000,status:'connected'}]});});
 it('rejects negative replies, malformed snapshots and unknown rooms',()=>{expect(()=>parseConferenceSnapshot('-ERR not found',row)).toThrow();expect(()=>parseConferenceSnapshot('{}',row)).toThrow();expect(()=>parseConferenceSnapshot('[]',row)).toThrow();expect(()=>parseConferenceSnapshot(body(),{...row,provider_room:'p11_t8_secret'})).toThrow();});
 it('controls only the persisted tenant room and confirms with observed snapshot',async()=>{const db={query:vi.fn(async()=>({rows:[row]}))},transport={api:vi.fn().mockResolvedValueOnce(body()).mockResolvedValueOnce('OK mute 8').mockResolvedValueOnce(JSON.stringify([{...observed,members:[{...observed.members[0],flags:{...observed.members[0].flags,can_speak:false}}]}]))};const p=createProvisionedConferenceProvider(db as any,transport);const result=await p.execute(scope,{...op,action:{type:'mute_participant',participantId:'8'}});expect(transport.api.mock.calls.map(c=>c[0])).toEqual(['conference p11_t7_meeting json_list','conference p11_t7_meeting mute 8','conference p11_t7_meeting json_list']);expect(result.participants[0].isMuted).toBe(true);});
 it('rejects member injection before any mutation',async()=>{const transport={api:vi.fn(async()=>body())},p=createProvisionedConferenceProvider({query:vi.fn(async()=>({rows:[row]}))} as any,transport);await expect(p.execute(scope,{...op,action:{type:'kick_participant',participantId:'8\nkick all'}})).rejects.toThrow();expect(transport.api).toHaveBeenCalledTimes(1);});
 it('rejects cross tenant mapping and non-moderator writes',async()=>{for(const bad of [{...row,provider_room:'p11_t8_other'},{...row,can_moderate:false}]){const transport={api:vi.fn()},p=createProvisionedConferenceProvider({query:vi.fn(async()=>({rows:[bad]}))} as any,transport);await expect(p.execute(scope,op)).rejects.toThrow();expect(transport.api).not.toHaveBeenCalled();}});
 it('does not treat ESL failure or missing post-ACK snapshot as success',async()=>{for(const reply of ['-ERR no such member','']){const p=createProvisionedConferenceProvider({query:vi.fn(async()=>({rows:[row]}))} as any,{api:vi.fn().mockResolvedValueOnce(body()).mockResolvedValueOnce(reply)});await expect(p.execute(scope,op)).rejects.toThrow();}});
 it('only ends after valid inventory proves no live callers',async()=>{const p=createProvisionedConferenceProvider({query:vi.fn(async()=>({rows:[row]}))} as any,{api:vi.fn().mockResolvedValueOnce(body()).mockResolvedValueOnce('OK kicked all').mockResolvedValueOnce('[]')});expect(await p.execute(scope,{type:'end',conferenceId:row.id})).toMatchObject({state:'ended',participants:[]});});
 it('limits raw transport grammar',async()=>{const esl=createConferenceEsl({host:'127.0.0.1',port:1,password:'test'});await expect(esl.api('conference foo kick all\nshutdown')).rejects.toThrow('Unsupported');await expect(esl.api('originate user/1001 &conference(foo)')).rejects.toThrow('Unsupported');});
});
describe('durable idempotency',()=>{
 it('stores claim before effect then persists observed result',async()=>{const query=vi.fn().mockResolvedValueOnce({rows:[{idempotency_key:key}]}).mockResolvedValueOnce({rows:[]});const effect=vi.fn(async()=>{expect(query).toHaveBeenCalledTimes(1);return snapshot();});await createConferenceRepository({query} as any).once(scope,key,op,effect);expect(effect).toHaveBeenCalledTimes(1);expect(query.mock.calls[1][0]).toContain("state='complete'");});
 it('does not replay uncertain operations',async()=>{const query=vi.fn().mockResolvedValueOnce({rows:[{}]});const r=createConferenceRepository({query} as any);await expect(r.once(scope,key,op,async()=>{throw new Error('timeout');})).rejects.toMatchObject({code:'PRECONDITION_FAILED'});expect(query).toHaveBeenCalledTimes(1);});
 it('replays completed results but blocks pending and mismatched reuse',async()=>{let fingerprint='';const query=vi.fn(async(sql:string,args:any[])=>{if(sql.startsWith('INSERT')){fingerprint=args[3];return {rows:[]};}return {rows:[{fingerprint,state:'complete',result:snapshot()}]};});const effect=vi.fn(async()=>snapshot());expect(await createConferenceRepository({query} as any).once(scope,key,op,effect)).toMatchObject({id:row.id});expect(effect).not.toHaveBeenCalled();for(const existing of [{fingerprint:'other',state:'complete'},{get fingerprint(){return fingerprint;},state:'pending'}]){query.mockImplementation(async(sql,args)=>{if(sql.startsWith('INSERT')){fingerprint=args[3];return {rows:[]};}return {rows:[existing]} as any;});await expect(createConferenceRepository({query} as any).once(scope,key,op,effect)).rejects.toMatchObject({code:'CONFLICT'});}});
});

describe('authenticated ESL framing',()=>{
 it('handles fragmented replies and never sends command before authentication',async()=>{
  const {createServer}=await import('node:net');const requests:string[]=[];
  const server=createServer(socket=>{socket.write('Content-Type: auth/request\n\n');let input='';socket.on('data',chunk=>{input+=chunk.toString();while(input.includes('\n\n')){const end=input.indexOf('\n\n'),request=input.slice(0,end);input=input.slice(end+2);requests.push(request);if(request==='auth test'){socket.write('Content-Type: command/reply\nReply-Text: +OK ');setImmediate(()=>socket.write('accepted\n\n'));}else {socket.write('Content-Type: api/response\nContent-Length: 2\n\n[');setImmediate(()=>socket.write(']'));}}});});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {const address=server.address() as {port:number};expect(await createConferenceEsl({host:'127.0.0.1',port:address.port,password:'test'}).api('conference json_list')).toBe('[]');expect(requests).toEqual(['auth test','api conference json_list']);}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
 });
 it('fails rejected authentication before sending a conference command',async()=>{
  const {createServer}=await import('node:net');const requests:string[]=[];
  const server=createServer(socket=>{socket.write('Content-Type: auth/request\n\n');socket.on('data',chunk=>{requests.push(chunk.toString());socket.write('Content-Type: command/reply\nReply-Text: -ERR invalid\n\n');});});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {const address=server.address() as {port:number};await expect(createConferenceEsl({host:'127.0.0.1',port:address.port,password:'test'}).api('conference json_list')).rejects.toThrow('protocol');expect(requests).toEqual(['auth test\n\n']);}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
 });
});
