import hashlib,importlib.util,re,sys,unittest
from pathlib import Path
from unittest.mock import patch
P=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('did_v2',P/'transform.py');m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m)
s=importlib.util.spec_from_file_location('did_v1_fixture',P.parent/'caller-convergence-v1/test_transform.py');f=importlib.util.module_from_spec(s);s.loader.exec_module(f)
SOURCE=f.SOURCE.replace(b'^[0-9]+$',b'^[1-9][0-9]{3}$')
SECRET=f.SECRET;INCLUDE=f.INCLUDE

def render(source=SOURCE):
 clean=m.v1.code(source.decode());a,b=m.v1.route_span(clean);left,right=m.consumer_span(clean)
 with patch.object(m.v1,'EXPECTED_MAIN_SHA',m.v1.sha(source)),patch.object(m.v1,'EXPECTED_ROUTE_SHA',m.v1.sha(clean[a:b].encode())),patch.object(m.v1,'EXPECTED_INCLUDE_SHA',m.v1.sha(INCLUDE)),patch.object(m,'CONSUMER_SHA',m.v1.sha(clean[left:right].encode())):return m.render(source,SECRET,INCLUDE)
class V2(unittest.TestCase):
 def test_immutable_v1_and_observed_consumer_pin(self):
  self.assertEqual(hashlib.sha256(m.V1.read_bytes()).hexdigest(),m.V1_SHA);self.assertEqual(m.CONSUMER_SHA,'39a93f6d6454c94ec0bcb96f291a552d6f6b5587bd2a5f238ea6d5220543a692')
 def test_consumer_pin_independently_refuses(self):
  clean=m.v1.code(SOURCE.decode());a,b=m.v1.route_span(clean)
  with patch.object(m.v1,'EXPECTED_MAIN_SHA',m.v1.sha(SOURCE)),patch.object(m.v1,'EXPECTED_ROUTE_SHA',m.v1.sha(clean[a:b].encode())),patch.object(m.v1,'EXPECTED_INCLUDE_SHA',m.v1.sha(INCLUDE)),self.assertRaisesRegex(m.Refused,'DID_V2_CONSUMER_SHA'):m.render(SOURCE,SECRET,INCLUDE)
 def test_uri_assignment_preserves_lookup_flexisip_and_rtp(self):
  x=render().private_source.decode();self.assertIn('$ru = $var(did_target);',x);self.assertIn('if (!lookup("location")) { route(RELAY); exit; }',x);self.assertIn('route(RTPENGINE_MANAGE);\n        route(RELAY);\n        exit;',x);self.assertIn(m.SIP_PATTERN,x)
 def test_nonnumeric_sip_identity_uses_existing_wake_grammar(self):
  n=(P.parents[2]/'server/push/wake-service.ts').read_text();self.assertIn('/'+m.SIP_PATTERN+'/',n)
  for value in ['sip:3001@sip.example.test','sip:t7e3001@sip.example.test','sip:digest-user@tenant.example','sip:User003@sip.example.test']:self.assertIsNotNone(re.fullmatch(m.SIP_PATTERN,value))
  for value in ['3001','sip:user:password@tenant.example','sip:a@tenant.example;transport=tcp','sip:a@tenant.example?header=x','sip:a@tenant.example\r\nBAD']:self.assertIsNone(re.fullmatch(m.SIP_PATTERN,value))
 def test_internal_type_specific_ids_match_encoder_requirements(self):
  for value in ['phone11pbx-ivr-7-23','phone11pbx-ringgroup-7-23','phone11pbx-queue-7-23','phone11pbx-timecondition-7-23']:self.assertIsNotNone(re.fullmatch(m.INTERNAL_PATTERN,value))
  self.assertIsNotNone(re.fullmatch(m.RINGALL_PATTERN,'phone11pbx-ringall-7-0'))
  for value in ['phone11pbx-ivr-7-0','phone11pbx-ringall-7-23','phone11pbx-ringall-0-0','phone11pbx-ivr-07-23','phone11pbx-ivr-7-023','phone11pbx-ivr-10000000000-23','phone11pbx-ivr-7-10000000000','phone11pbx-unknown-7-1']:
   self.assertIsNone(re.fullmatch(m.INTERNAL_PATTERN,value));self.assertIsNone(re.fullmatch(m.RINGALL_PATTERN,value))
 def test_old_cache_namespace_ignored_no_global_flush(self):
  x=render().private_source.decode();self.assertIn('$var(phone11_did_cache_key) = "phone11_did_v2:" + $rU;',x);self.assertNotRegex(x,m.OLD_CACHE_RE);self.assertEqual(x.count(m.NEW_CACHE),4);self.assertNotIn('htable.flush',x);self.assertNotIn('sht_rm',x);self.assertLess(x.index('"phone11_did_v2:"'),x.index(m.NEW_CACHE))
 def test_four_digit_or_malformed_cached_target_cleared_denied(self):
  for value in ['3001','', 'phone11pbx-ivr-7-0','sip:a@tenant.example;bad']:
   self.assertFalse(any(re.fullmatch(pattern,value)for pattern in [m.SIP_PATTERN,m.INTERNAL_PATTERN,m.RINGALL_PATTERN]))
  x=render().private_source.decode();tail=x[x.rindex(m.NEW_CACHE):];self.assertTrue(tail.startswith(m.NEW_CACHE+' = $null;'));self.assertIn('sl_send_reply("404", "Not Found");',tail);self.assertIn('exit;',tail)
 def test_fresh_action_bound_to_target_shape_before_cache(self):
  x=render().private_source.decode();write=x.index(m.NEW_CACHE+' = $var(did_target);');prefix=x[:write];self.assertIn('== "bridge" && !($var(did_target) =~',prefix);self.assertIn('== "freeswitch" && !($var(did_target) =~',prefix);self.assertIn('== "ring_all" && !($var(did_target) =~',prefix)
 def test_reject_no_target_and_non200_transport_semantics_preserved(self):
  x=render().private_source.decode();self.assertIn('if ($var(phone11_did_action) == "reject")',x);self.assertIn('$var(did_target) == $null || $var(did_target) == ""',x);self.assertIn('sl_send_reply("403", "Forbidden"); exit;',x);self.assertIn('sl_send_reply("500", "Routing Failed"); exit;',x);self.assertIn('} else {\n            route(TO_FREESWITCH);\n            exit;\n        }',x)
 def test_outside_route_and_ports_unchanged_prototype_remains_inert(self):
  result=render();x=result.private_source.decode();self.assertTrue(x.startswith(f.PREFIX));self.assertTrue(x.endswith('route[UNRELATED] { exit; }\n'));self.assertIn('http://127.0.0.1:3000',x);self.assertFalse(result.execution_eligible);self.assertFalse(result.vendor_parse_proven);self.assertFalse(result.live_backend_binding_proven);self.assertFalse(result.live_target_consumer_compatibility_proven);self.assertNotIn(SECRET,repr(result));masked=m.v1.mask(m.v1.code(x));self.assertEqual(masked.count('{'),masked.count('}'));self.assertEqual(masked.count('('),masked.count(')'))
if __name__=='__main__':unittest.main()
