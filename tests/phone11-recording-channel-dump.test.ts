import {beforeEach,afterEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({api:vi.fn(),query:vi.fn(),bind:vi.fn(),persist:vi.fn()}));
vi.mock('../server/pbx/db',()=>({getPool:()=>({query:mocks.query})}));
vi.mock('../server/cloud-recordings/correlation',()=>({bindIncomingChannel:mocks.bind}));
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
