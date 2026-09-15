import {describe,it,expect,vi,beforeEach} from 'vitest';
const db=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('../server/pbx/db',()=>({query:db.query,withTransaction:async(fn:any)=>fn(db)}));
import {bindAuthenticatedOutbound,trustedRecordingRoute,bindIncomingChannel} from '../server/cloud-recordings/correlation';
const id='00000000-0000-4000-8000-000000000001';
beforeEach(()=>{db.query.mockReset();vi.stubEnv('PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED','true');});
describe('trusted capture correlation',()=>{
 it('does not use caller From or raw extension vars as authenticated identity',async()=>{await bindAuthenticatedOutbound({'Unique-ID':id,variable_sip_from_user:'3001',variable_extension_id:11},'+66123456789');expect(db.query).not.toHaveBeenCalled();});
 it('gateoff touches no tables',async()=>{vi.stubEnv('PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED','false');await bindAuthenticatedOutbound({'Unique-ID':id,variable_sip_auth_username:'3001',variable_sip_auth_realm:'test'},'test');expect(await trustedRecordingRoute(id,'sip')).toBeNull();expect(db.query).not.toHaveBeenCalled();});
 it('requires unique active authenticated assignment',async()=>{db.query.mockResolvedValue({rows:[{id:11,tenant_id:10},{id:12,tenant_id:20}]});await bindAuthenticatedOutbound({'Unique-ID':id,variable_sip_auth_username:'3001',variable_sip_auth_realm:'test'},'test');expect(db.query).toHaveBeenCalledTimes(1);});
 it('preserves exact inbound SIP identity and fails closed for rewritten IDs',async()=>{db.query.mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[]});expect(await trustedRecordingRoute(id,'rewritten')).toBeNull();expect(db.query.mock.calls[1][1]).toEqual(['rewritten']);});
 it('accepts unique persisted inbound link but rejects cross-tenant ambiguity',async()=>{db.query.mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{tenant_id:10,extension_id:11}]});expect(await trustedRecordingRoute(id,'sip')).toEqual({tenantId:10,extensionId:11});db.query.mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{tenant_id:10,extension_id:11},{tenant_id:20,extension_id:21}]});expect(await trustedRecordingRoute(id,'sip')).toBeNull();});
 it('incoming channel requires exact unique recent wake identity before any write',async()=>{db.query.mockResolvedValue({rows:[]});expect(await bindIncomingChannel(id,'different','+66123456789')).toBe(false);expect(db.query).toHaveBeenCalledTimes(1);expect(db.query.mock.calls[0][1]).toEqual(['different']);});
 it('incoming correlation persists stable native wake ID, not displaynumber authority',async()=>{db.query.mockResolvedValueOnce({rows:[{tenant_id:10,extension_id:11,wake_uuid:id}]}).mockResolvedValueOnce({rows:[{channel_uuid:id}]}).mockResolvedValueOnce({rows:[]});expect(await bindIncomingChannel(id,'exact','caller@example.com')).toBe(true);expect(db.query.mock.calls[1][1]).toEqual([id,10,11,'exact','Unknown']);expect(db.query.mock.calls[2][1]).toEqual([id,10,11,`native-wake:${id}`,'Unknown']);});

});
