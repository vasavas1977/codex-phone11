import {describe,it,expect,vi,beforeEach} from 'vitest';
const db=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('../server/pbx/db',()=>({query:db.query,withTransaction:async(fn:any)=>fn(db)}));
import {bindAuthenticatedOutbound,trustedRecordingRoute,bindIncomingChannel,bindObservedOutboundChannel} from '../server/cloud-recordings/correlation';
const id='00000000-0000-4000-8000-000000000001';
const nonce='22222222-2222-4222-8222-222222222222';
const observed=(overrides:Record<string,string>={})=>({'Unique-ID':id,variable_sip_call_id:'exact@sip','Caller-Destination-Number':'+66800000000','Call-Direction':'inbound',variable_call_direction:'outbound',variable_sip_received_ip:'10.0.0.8',variable_sofia_profile_name:'external',variable_phone11_outbound_id:nonce,variable_phone11_authenticated_user:'3001',variable_phone11_authenticated_realm:'phone11.invalid',...overrides});
beforeEach(()=>{db.query.mockReset();vi.stubEnv('PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED','true');vi.stubEnv('PHONE11_RECORDING_TRUSTED_PROXY_IPS','10.0.0.8,2001:db8::8');vi.stubEnv('PHONE11_RECORDING_TRUSTED_PROXY_PROFILE','external');});
describe('trusted capture correlation',()=>{
 it('does not use caller From or raw extension vars as authenticated identity',async()=>{await bindAuthenticatedOutbound({'Unique-ID':id,variable_sip_from_user:'3001',variable_extension_id:11},'+66123456789');expect(db.query).not.toHaveBeenCalled();});
 it('gateoff touches no tables',async()=>{vi.stubEnv('PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED','false');await bindAuthenticatedOutbound({'Unique-ID':id,variable_sip_auth_username:'3001',variable_sip_auth_realm:'test'},'test');expect(await trustedRecordingRoute(id,'sip')).toBeNull();expect(db.query).not.toHaveBeenCalled();});
 it('requires unique active authenticated assignment',async()=>{db.query.mockResolvedValue({rows:[{id:11,tenant_id:10},{id:12,tenant_id:20}]});await bindAuthenticatedOutbound({'Unique-ID':id,variable_sip_auth_username:'3001',variable_sip_auth_realm:'test'},'test');expect(db.query).toHaveBeenCalledTimes(1);});
 it('preserves exact inbound SIP identity and fails closed for rewritten IDs',async()=>{db.query.mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[]});expect(await trustedRecordingRoute(id,'rewritten')).toBeNull();expect(db.query.mock.calls[1][1]).toEqual(['rewritten']);});
 it('accepts unique persisted inbound link but rejects cross-tenant ambiguity',async()=>{db.query.mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{tenant_id:10,extension_id:11}]});expect(await trustedRecordingRoute(id,'sip')).toEqual({tenantId:10,extensionId:11});db.query.mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{tenant_id:10,extension_id:11},{tenant_id:20,extension_id:21}]});expect(await trustedRecordingRoute(id,'sip')).toBeNull();});
 it('incoming channel requires exact unique recent wake identity before any write',async()=>{db.query.mockResolvedValue({rows:[]});expect(await bindIncomingChannel(id,'different','+66123456789')).toBe(false);expect(db.query).toHaveBeenCalledTimes(1);expect(db.query.mock.calls[0][1]).toEqual(['different']);});
 it('incoming correlation persists stable native wake ID, not displaynumber authority',async()=>{db.query.mockResolvedValueOnce({rows:[{tenant_id:10,extension_id:11,wake_uuid:id}]}).mockResolvedValueOnce({rows:[{channel_uuid:id}]}).mockResolvedValueOnce({rows:[]});expect(await bindIncomingChannel(id,'exact','caller@example.com')).toBe(true);expect(db.query.mock.calls[1][1]).toEqual([id,10,11,'exact','Unknown']);expect(db.query.mock.calls[2][1]).toEqual([id,10,11,`native-wake:${id}`,'Unknown']);});
 it('binds one exact observed outbound A-leg and persists its native history ID atomically',async()=>{
  db.query.mockResolvedValueOnce({rows:[{id:11,tenant_id:10}]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{channel_uuid:id}]}).mockResolvedValueOnce({rows:[{call_uuid:id}]});
  expect(await bindObservedOutboundChannel(observed())).toBe(true);
  expect(db.query.mock.calls[5][1]).toEqual([id,10,11,'exact@sip','+66800000000']);
  expect(db.query.mock.calls[6][1]).toEqual([id,10,11,`native-outbound:${nonce}`,'+66800000000']);
 });
 it('is idempotent only for the same channel, SIP identity, owner and native ID',async()=>{
  const route={tenant_id:10,extension_id:11,sip_call_id:'exact@sip',direction:'outbound'};
  const cloud={call_uuid:id,tenant_id:10,extension_id:11,native_history_id:`native-outbound:${nonce}`,direction:'outbound'};
  db.query.mockResolvedValueOnce({rows:[{id:11,tenant_id:10}]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[route]}).mockResolvedValueOnce({rows:[cloud]}).mockResolvedValueOnce({rows:[cloud]});
  expect(await bindObservedOutboundChannel(observed())).toBe(true);expect(db.query).toHaveBeenCalledTimes(5);
 });
 it('rejects missing trust configuration, proxy mismatch, wrong leg, malformed nonce and injected duplicate header without database work',async()=>{
  const invalid=[observed({variable_sip_received_ip:'10.0.0.9'}),observed({variable_sofia_profile_name:'internal'}),observed({'Call-Direction':'outbound'}),observed({variable_phone11_outbound_id:'not-a-uuid'}),observed({variable_phone11_outbound_id:`${nonce},${nonce}`}),observed({variable_phone11_authenticated_user:'3001,foreign'}),observed({variable_phone11_authenticated_realm:'phone11.invalid,foreign.invalid'}),observed({variable_bypass_media:'true'}),observed({variable_bypass_media_after_bridge:'true'}),observed({variable_bypass_media_after_bridge:'unknown'}),observed({variable_proxy_media:'1'})];
  for(const fields of invalid)expect(await bindObservedOutboundChannel(fields)).toBe(false);
  vi.stubEnv('PHONE11_RECORDING_TRUSTED_PROXY_IPS','');expect(await bindObservedOutboundChannel(observed())).toBe(false);
  vi.stubEnv('PHONE11_RECORDING_TRUSTED_PROXY_IPS','10.0.0.8,not-an-ip');expect(await bindObservedOutboundChannel(observed())).toBe(false);
  vi.stubEnv('PHONE11_RECORDING_TRUSTED_PROXY_PROFILE','');expect(await bindObservedOutboundChannel(observed())).toBe(false);
  expect(db.query).not.toHaveBeenCalled();
 });
 it('rejects a reused nonce or channel collision without leaving a partial route',async()=>{
  const foreign={call_uuid:'33333333-3333-4333-8333-333333333333',tenant_id:20,extension_id:21,native_history_id:`native-outbound:${nonce}`,direction:'outbound'};
  db.query.mockResolvedValueOnce({rows:[{id:11,tenant_id:10}]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[foreign]}).mockResolvedValueOnce({rows:[]});
  expect(await bindObservedOutboundChannel(observed())).toBe(false);expect(db.query).toHaveBeenCalledTimes(5);
  expect(db.query.mock.calls.some(([sql])=>String(sql).startsWith('INSERT INTO phone11_recording_routes'))).toBe(false);
 });

});
