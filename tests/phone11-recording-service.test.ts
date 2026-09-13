import { beforeEach,describe,it,expect,vi } from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn(),api:vi.fn(),failed:vi.fn(),pendingUploads:vi.fn(),active:vi.fn(),discard:vi.fn(),complete:vi.fn(),uploaded:vi.fn(),cleaned:vi.fn(),releaseCompletion:vi.fn(),putCompleted:vi.fn()}));
vi.mock('../server/pbx/db',()=>({getPool:()=>({query:mocks.query})}));
vi.mock('../server/cloud-recordings/correlation',()=>({bindIncomingChannel:vi.fn()}));
vi.mock('../server/cloud-recordings/capture-ledger',()=>({createCaptureLedger:()=>({failed:mocks.failed,pendingUploads:mocks.pendingUploads,active:mocks.active,complete:mocks.complete,uploaded:mocks.uploaded,cleaned:mocks.cleaned,releaseCompletion:mocks.releaseCompletion})}));
vi.mock('../server/cloud-recordings/esl-capture',()=>({createEslCaptureTransport:()=>({api:mocks.api})}));
vi.mock('../server/cloud-recordings/capture-spool',()=>({createCaptureSpool:()=>({discardCompleted:mocks.discard,putCompleted:mocks.putCompleted})}));
import {createRecordingCaptureService} from '../server/cloud-recordings/capture-service';
const id='11111111-1111-4111-8111-111111111111',token='22222222-2222-4222-8222-222222222222';
function service(){return createRecordingCaptureService({esl:{host:'fixture',port:1,password:'fixture',announcementPath:'/opt/phone11ai/prompts/a.wav'},spoolDirectory:'/unused',uploadEndpoint:'https://invalid/api/recordings/upload',integrationSecret:'fixture'});}
beforeEach(()=>{vi.clearAllMocks();process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED='true';mocks.pendingUploads.mockResolvedValue([]);mocks.api.mockImplementation(async(c:string)=>c==='show channels as json'?'{"rows":[]}':c.startsWith('uuid_exists')?'true':'+OK');});
describe('capture reconciliation safeguards',()=>{
 it('checks manual stop actor in ledger before command',async()=>{mocks.active.mockResolvedValue(null);expect(await service().manualStop(id,7)).toBe(false);expect(mocks.active).toHaveBeenCalledWith(id,7);expect(mocks.api).not.toHaveBeenCalled();});
 it('cleanup tick stops existing recorder with global capture disabled',async()=>{process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED='false';mocks.query.mockResolvedValue({rows:[{call_uuid:id,tenant_id:2,extension_id:3,capture_token:token,recording_status:'recording',mode:'automatic',expired:false}]});await service().tick();expect(mocks.api).toHaveBeenCalledWith(`uuid_record ${id} stop /var/lib/freeswitch/recordings/phone11/2/${token}.wav`);expect(mocks.discard).toHaveBeenCalled();});
 it('revocation cleans previously confirmed stop without stopping recorder twice',async()=>{mocks.query.mockResolvedValue({rows:[{call_uuid:id,tenant_id:2,extension_id:3,capture_token:token,capture_stopped_at:new Date(),recording_status:'recording',mode:'off',expired:false}]});await service().tick();expect(mocks.api.mock.calls.some(([c])=>String(c).startsWith('uuid_record'))).toBe(false);expect(mocks.discard).toHaveBeenCalled();expect(mocks.failed).toHaveBeenCalled();});
 it('stops expired active recording then cleans only after transport confirms completion',async()=>{mocks.query.mockResolvedValue({rows:[{call_uuid:id,tenant_id:2,extension_id:3,capture_token:token,recording_status:'recording',mode:'automatic',expired:true}]});await service().tick();expect(mocks.api).toHaveBeenCalledWith(`uuid_record ${id} stop /var/lib/freeswitch/recordings/phone11/2/${token}.wav`);expect(mocks.discard).toHaveBeenCalled();expect(mocks.failed).toHaveBeenCalled();});
 it('expired pending reservation cleans after confirmed exact recorder stop',async()=>{mocks.query.mockResolvedValue({rows:[{call_uuid:id,tenant_id:2,extension_id:3,capture_token:token,recording_status:'pending',mode:'automatic',pending_expired:true}]});await service().tick();expect(mocks.api).toHaveBeenCalledWith(`uuid_record ${id} stop /var/lib/freeswitch/recordings/phone11/2/${token}.wav`);expect(mocks.discard).toHaveBeenCalled();expect(mocks.failed).toHaveBeenCalled();});
 it('periodic retry recovers a pre-CDR upload rejection after hangup without discarding stopped media',async()=>{
  const path=`/var/lib/freeswitch/recordings/phone11/2/${token}.wav`;
  const lease={channelUuid:id,callUuid:id,tenantId:2,extensionId:3,token,path,uploadLeaseToken:'lease'};
  mocks.query.mockResolvedValue({rows:[]});
  mocks.complete.mockResolvedValue(lease);mocks.uploaded.mockResolvedValue(undefined);mocks.cleaned.mockResolvedValue(undefined);
  mocks.releaseCompletion.mockResolvedValue(undefined);mocks.putCompleted.mockRejectedValueOnce(new Error('CDR not yet present')).mockResolvedValueOnce('stored-key');
  const s=service();await expect(s.onAuthenticatedRecordStop(id,path)).rejects.toThrow('CDR not yet present');
  expect(mocks.releaseCompletion).toHaveBeenCalledWith(lease);expect(mocks.discard).not.toHaveBeenCalled();expect(mocks.failed).not.toHaveBeenCalled();
  // The persistent stopped marker makes the same token eligible on a later tick.
  mocks.pendingUploads.mockResolvedValue([{channelUuid:id,path}]);await s.tick();
  expect(mocks.complete).toHaveBeenCalledTimes(2);expect(mocks.complete).toHaveBeenLastCalledWith(id,path);
  expect(mocks.uploaded).toHaveBeenCalledWith(lease,'stored-key');expect(mocks.discard).toHaveBeenCalledWith(lease);expect(mocks.cleaned).toHaveBeenCalledWith(lease);
  expect(mocks.uploaded.mock.invocationCallOrder[0]).toBeLessThan(mocks.discard.mock.invocationCallOrder[0]);
 });

});
