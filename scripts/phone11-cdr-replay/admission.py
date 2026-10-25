"""Pure trusted-route admission SELECT builder; no runtime I/O or credentials."""
import re

class AdmissionRefused(ValueError):
 pass

def need(value,code):
 if not value:raise AdmissionRefused(code)

def admission_sql(identity):
 need(type(identity)is dict and set(identity)=={'uuid','tenantId','sha256','sipCallId'},'ADMISSION_IDENTITY')
 uuid=identity['uuid'];tenant=identity['tenantId'];sip=identity['sipCallId']
 need(type(uuid)is str and re.fullmatch('[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',uuid)is not None and type(tenant)is int and 0<tenant<=2147483647 and type(identity['sha256'])is str and re.fullmatch('[a-f0-9]{64}',identity['sha256'])is not None,'ADMISSION_IDENTITY')
 need(sip is None or(type(sip)is str and 0<len(sip)<=512 and not any(ord(v)<32 or ord(v)==127 for v in sip)),'SIP_IDENTITY')
 value='NULL::text'if sip is None else"convert_from(decode('"+sip.encode('utf8').hex()+"','hex'),'UTF8')"
 # Exact730 direct-UUID route takes priority. A known nonempty SIP binding must
 # match; active extension/tenant is mandatory. Ambiguous/inactive source rows
 # conservatively refuse rather than downgrade a previously owned record.
 return f"""BEGIN READ ONLY; SET LOCAL search_path=pg_catalog,public;
WITH input AS(SELECT '{uuid}'::uuid AS uuid,{tenant}::integer AS tenant,{value} AS sip),
direct AS(SELECT rr.tenant_id,rr.extension_id,rr.sip_call_id,e.status='active'AND e.deleted_at IS NULL AND t.status='active'AS active FROM public.phone11_recording_routes rr LEFT JOIN public.extensions e ON e.id=rr.extension_id AND e.tenant_id=rr.tenant_id LEFT JOIN public.tenants t ON t.id=e.tenant_id,input i WHERE rr.channel_uuid=i.uuid),
wake AS(SELECT DISTINCT w.tenant_id,w.extension_id FROM public.phone11_recording_wake_links w JOIN public.extensions e ON e.id=w.extension_id AND e.tenant_id=w.tenant_id JOIN public.tenants t ON t.id=e.tenant_id,input i WHERE w.sip_call_id=i.sip AND e.status='active'AND e.deleted_at IS NULL AND t.status='active')
SELECT json_build_object('admitted',EXISTS(SELECT 1 FROM public.tenants t,input i WHERE t.id=i.tenant AND t.status='active')
 AND NOT EXISTS(SELECT 1 FROM public.call_records r,input i WHERE r.call_uuid::text=i.uuid::text AND r.tenant_id IS DISTINCT FROM i.tenant)
 AND NOT EXISTS(SELECT 1 FROM public.call_legs l,input i WHERE l.leg_uuid::text=i.uuid::text AND l.tenant_id IS DISTINCT FROM i.tenant)
 AND CASE WHEN(SELECT count(*)FROM direct)=1 THEN(SELECT d.active IS TRUE AND d.tenant_id=i.tenant AND(coalesce(d.sip_call_id,'')=''OR d.sip_call_id IS NOT DISTINCT FROM i.sip)FROM direct d,input i)
 WHEN(SELECT count(*)FROM direct)>1 THEN false WHEN(SELECT count(*)FROM wake)=1 THEN(SELECT w.tenant_id=i.tenant FROM wake w,input i)WHEN(SELECT count(*)FROM wake)>1 THEN false ELSE false END);
ROLLBACK;
"""

