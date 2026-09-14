import {beforeEach,afterEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({api:vi.fn(),query:vi.fn(),bind:vi.fn(),observed:vi.fn(),persist:vi.fn()}));
vi.mock('../server/pbx/db',()=>({getPool:()=>({query:mocks.query})}));
vi.mock('../server/cloud-recordings/correlation',()=>({bindIncomingChannel:mocks.bind,bindObservedOutboundChannel:mocks.observed}));
vi.mock('../server/cloud-recordings/route-cdr',()=>({persistRouteCdr:mocks.persist}));
vi.mock('../server/cloud-recordings/capture-ledger',()=>({createCaptureLedger:()=>({pendingUploads:async()=>[]})}));
vi.mock('../server/cloud-recordings/esl-capture',()=>({createEslCaptureTransport:()=>({api:mocks.api})}));
vi.mock('../server/cloud-recordings/capture-spool',()=>({createCaptureSpool:()=>({})}));
import {createRecordingCaptureService,parseRecordingChannelDump} from '../server/cloud-recordings/capture-service';
const id='11111111-1111-4111-8111-111111111111';
const fields=(sip='call@example.test')=>({'Unique-ID':id,variable_sip_call_id:sip,'Caller-Channel-Created-Time':'1789300000000000','Caller-Caller-ID-Number':'+6620303001'});
const service=()=>createRecordingCaptureService({esl:{host:'fixture',port:1,password:'fixture',announcementPath:'/opt/phone11ai/prompts/a.wav'},spoolDirectory:'/unused',uploadEndpoint:'https://invalid/upload',integrationSecret:'fixture'});
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED','true');mocks.query.mockResolvedValue({rows:[]});});
afterEach(()=>vi.unstubAllEnvs());
it.each(['call@example.test','call%40example.test','call%2540@example.test','call+tag@example.test'])('preserves exact SIP identity %s through the actual service tick',async(sip)=>{
 mocks.api.mockImplementation(async(command:string)=>command==='show channels as json'?JSON.stringify({rows:[{uuid:id}]}):JSON.stringify(fields(sip)));
 await service().tick();
 expect(mocks.api).toHaveBeenCalledWith(`uuid_dump ${id} json`);
 expect(mocks.bind).toHaveBeenCalledWith(id,sip,'+6620303001');
 expect(mocks.persist).toHaveBeenCalledWith(expect.anything(),id,fields(sip));
});
it.each(['invalid','null','[]',JSON.stringify({...fields(),'Unique-ID':'22222222-2222-4222-8222-222222222222'}),JSON.stringify({...fields(),variable_sip_call_id:123}),JSON.stringify({...fields(),variable_sip_call_id:['call@example.test']}),JSON.stringify({...fields(),variable_sip_call_id:'call\nforged'}),JSON.stringify({...fields(),'Caller-Channel-Created-Time':123})])('rejects malformed or mismatched snapshots before binding ownership: %s',async(body)=>{
 mocks.api.mockImplementation(async(command:string)=>command==='show channels as json'?JSON.stringify({rows:[{uuid:id}]}):body);
 await service().tick();expect(mocks.bind).not.toHaveBeenCalled();expect(mocks.persist).not.toHaveBeenCalled();
});
it('excludes arbitrary tenant fields and does not normalize whitespace into another SIP ID',()=>{
 const result=parseRecordingChannelDump(JSON.stringify({...fields(' call@example.test '),tenant_id:'123'}),id);
 expect(result.variable_sip_call_id).toBe(' call@example.test ');expect(result).not.toHaveProperty('tenant_id');
});
it('keeps only FreeSWITCH internal outbound markers and media guards while excluding raw protected SIP headers',()=>{
 const result=parseRecordingChannelDump(JSON.stringify({...fields(),variable_bypass_media_after_bridge:'false',variable_phone11_outbound_id:'22222222-2222-4222-8222-222222222222',variable_phone11_authenticated_user:'3001',variable_phone11_authenticated_realm:'phone11.invalid','variable_sip_h_X-Phone11-Outbound-ID':'attacker','variable_sip_h_X-Phone11-Authenticated-User':'attacker','variable_sip_h_X-Phone11-Authenticated-Realm':'attacker'}),id);
 expect(result).toMatchObject({variable_bypass_media_after_bridge:'false',variable_phone11_outbound_id:'22222222-2222-4222-8222-222222222222',variable_phone11_authenticated_user:'3001',variable_phone11_authenticated_realm:'phone11.invalid'});
 expect(Object.keys(result).some(key=>key.startsWith('variable_sip_h_X-Phone11-'))).toBe(false);
});
it('sends only the trusted-proxy inbound A-leg of an outbound bridge to outbound correlation',async()=>{
 const outbound={...fields(),'Caller-Destination-Number':'+66800000000','Call-Direction':'inbound',variable_call_direction:'outbound',variable_sip_received_ip:'10.0.0.8',variable_sofia_profile_name:'external',
  variable_phone11_outbound_id:'22222222-2222-4222-8222-222222222222',variable_phone11_authenticated_user:'3001',variable_phone11_authenticated_realm:'phone11.invalid'};
 mocks.api.mockImplementation(async(command:string)=>command==='show channels as json'?JSON.stringify({rows:[{uuid:id}]}):JSON.stringify(outbound));
 await service().tick();
 expect(mocks.observed).toHaveBeenCalledWith(outbound);expect(mocks.bind).not.toHaveBeenCalled();
 expect(mocks.persist).toHaveBeenCalledWith(expect.anything(),id,outbound);
});
it('does not bind the outgoing FreeSWITCH bridge leg as a handset-owned channel',async()=>{
 const bleg={...fields(),'Call-Direction':'outbound',variable_call_direction:'outbound',variable_sip_received_ip:'10.0.0.8',variable_sofia_profile_name:'external',
  variable_phone11_outbound_id:'22222222-2222-4222-8222-222222222222',variable_phone11_authenticated_user:'3001',variable_phone11_authenticated_realm:'phone11.invalid'};
 mocks.api.mockImplementation(async(command:string)=>command==='show channels as json'?JSON.stringify({rows:[{uuid:id}]}):JSON.stringify(bleg));
 await service().tick();expect(mocks.observed).not.toHaveBeenCalled();expect(mocks.bind).not.toHaveBeenCalled();
});
it('selects exactly one inbound A-leg from a connected outbound bridge snapshot',async()=>{
 const peer='33333333-3333-4333-8333-333333333333';
 const common={'Caller-Destination-Number':'+66800000000',variable_call_direction:'outbound',variable_sip_received_ip:'10.0.0.8',variable_sofia_profile_name:'external',variable_phone11_outbound_id:'22222222-2222-4222-8222-222222222222',variable_phone11_authenticated_user:'3001',variable_phone11_authenticated_realm:'phone11.invalid'};
 const aleg={...fields(),...common,'Call-Direction':'inbound'};
 const bleg={...fields(),...common,'Unique-ID':peer,variable_sip_call_id:'carrier-leg@example.test','Call-Direction':'outbound'};
 mocks.api.mockImplementation(async(command:string)=>command==='show channels as json'?JSON.stringify({rows:[{uuid:id},{uuid:peer}]}):command===`uuid_dump ${id} json`?JSON.stringify(aleg):JSON.stringify(bleg));
 await service().tick();expect(mocks.observed).toHaveBeenCalledTimes(1);expect(mocks.observed).toHaveBeenCalledWith(aleg);expect(mocks.bind).not.toHaveBeenCalled();
});
