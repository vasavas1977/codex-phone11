import hashlib,importlib.util,json,re,sys,unittest
from pathlib import Path
from unittest.mock import patch
P=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('did_transform',P/'transform.py');m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
SECRET='synthetic-did-secret-01234567890123456789'
PREFIX='''#!substdef "!BACKEND_URL!http://127.0.0.1:3000!g"
#!substdef "!KAM_SECRET!SECRET_VALUE!g"
modparam("http_client", "httpcon", "backend=>BACKEND_URL")
route[INVITE] {
    if ($rU =~ "^\\\\+?[0-9]{9,15}$") {
        route(DID_ROUTE);
        exit;
    }
}
'''.replace('SECRET_VALUE',SECRET)
ROUTE='''route[DID_ROUTE] {
    if ($sht(did_cache=>$rU) != $null) {
        $var(did_target) = $sht(did_cache=>$rU);
    } else {
        $var(api_url) = "/api/kamailio/route?secret=KAM_SECRET&number=" + $rU;
        $var(rc) = http_connect("backend", "$var(api_url)", "$var(api_result)");
        if ($var(rc) == 200) {
            jansson_get("target", $var(api_result), "$var(did_target)");
            $sht(did_cache=>$rU) = $var(did_target);
            xlog("L_INFO", "synthetic routing result\\n");
        } else {
            route(TO_FREESWITCH);
            exit;
        }
    }
    if ($var(did_target) =~ "^[0-9]+$") {
        $rU = $var(did_target);
        if (!lookup("location")) { route(RELAY); exit; }
        route(RTPENGINE_MANAGE);
        route(RELAY);
        exit;
    }
    $rU = $var(did_target);
    route(TO_FREESWITCH);
    exit;
}
'''
SOURCE=(PREFIX+ROUTE+'route[UNRELATED] { exit; }\n').encode()
INCLUDE=b'route[OUTBOUND_FIXTURE] { exit; }\n'
def pins(raw):
 clean=m.code(raw.decode());a,b=m.route_span(clean);return m.sha(raw),m.sha(clean[a:b].encode())
def apply(raw=SOURCE,secret=SECRET):
 a,b=pins(raw)
 with patch.object(m,'EXPECTED_MAIN_SHA',a),patch.object(m,'EXPECTED_ROUTE_SHA',b),patch.object(m,'EXPECTED_INCLUDE_SHA',m.sha(INCLUDE)):return m.render(raw,secret,INCLUDE)
class Transform(unittest.TestCase):
 def test_production_pins_fixed_and_synthetic_not_admitted_by_default(self):
  self.assertEqual(m.EXPECTED_MAIN_SHA,'92287d910a8886018a9f3207f127ff28953dee4b3c363732591b9fa5d0a89406');self.assertEqual(m.EXPECTED_ROUTE_SHA,'8e5f17e8b6ea695950babceeeac218bb0566e19418a9fe49d82e49749ed73f61')
  with self.assertRaises(m.Refused):m.render(SOURCE,SECRET,INCLUDE)
 def test_render_supported_four_argument_post_header_body(self):
  result=apply();x=result.private_source.decode();self.assertIn('http_client_query("$var(api_url)", "$var(api_body)", "$var(api_headers)", "$var(api_result)")',x);self.assertIn('"BACKEND_URL/api/kamailio/route"',x);self.assertIn('x-kam-secret: KAM_SECRET',x);self.assertIn('\\"ruri_user\\"',x);self.assertNotIn('?secret=',x);self.assertNotIn('&number=',x);self.assertNotIn('http_connect(',x);self.assertNotIn(SECRET,repr(result));self.assertFalse(result.execution_eligible);self.assertFalse(result.vendor_parse_proven);self.assertFalse(result.target_consumer_compatibility_proven)
 def test_backend_secret_absent_wrong_or_unsafe_refuses_without_values(self):
  for secret in [None,'',SECRET+'wrong']:
   with self.assertRaises(m.Refused)as error:apply(secret=secret)
   self.assertNotIn(SECRET,str(error.exception))
  raw=SOURCE.replace(SECRET.encode(),b'unsafe-header-secret-\r\n-injection')
  with self.assertRaises(m.Refused):apply(raw)
 def test_concrete_url_secret_must_match_existing_substitution(self):
  self.assertIn(b'x-kam-secret',apply(SOURCE.replace(b'secret=KAM_SECRET',b'secret='+SECRET.encode())).private_source)
  with self.assertRaisesRegex(m.Refused,'DID_URL_SECRET_MISMATCH'):apply(SOURCE.replace(b'secret=KAM_SECRET',b'secret=DIFFERENT_VALUE'))
 def test_route_digest_independent_refusal(self):
  a,_=pins(SOURCE)
  with patch.object(m,'EXPECTED_MAIN_SHA',a),patch.object(m,'EXPECTED_INCLUDE_SHA',m.sha(INCLUDE)),patch.object(m,'EXPECTED_ROUTE_SHA','0'*64),self.assertRaisesRegex(m.Refused,'DID_ROUTE_SHA'):m.render(SOURCE,SECRET,INCLUDE)
 def test_outside_route_and_cache_hit_transport_fallback_consumer_unchanged(self):
  x=apply().private_source.decode();self.assertTrue(x.startswith(PREFIX));self.assertTrue(x.endswith('route[UNRELATED] { exit; }\n'));self.assertIn('if ($sht(did_cache=>$rU) != $null) {\n        $var(did_target) = $sht(did_cache=>$rU);',x);self.assertIn('} else {\n            route(TO_FREESWITCH);\n            exit;\n        }',x);self.assertEqual(x[x.index('    if ($var(did_target) =~'):x.index('route[UNRELATED]')],ROUTE[ROUTE.index('    if ($var(did_target) =~'):])
 def test_200_reject_403_404_500_fixed_reply_then_exit_before_cache(self):
  x=apply().private_source.decode();start=x.index('if ($var(phone11_did_action) == "reject")');end=x.index('if (($var(phone11_did_action)',start);guard=x[start:end];self.assertIn('sl_send_reply("403", "Forbidden"); exit;',guard);self.assertIn('sl_send_reply("500", "Routing Failed"); exit;',guard);self.assertIn('sl_send_reply("404", "Not Found");\n                exit;',guard);self.assertNotIn('TO_FREESWITCH',guard);self.assertLess(start,x.index('$sht(did_cache=>$rU) ='))
 def test_200_missing_target_unknown_action_cannot_cache(self):
  x=apply().private_source.decode();start=x.index('if (($var(phone11_did_action)');cache=x.index('$sht(did_cache=>$rU) =');guard=x[start:cache];self.assertIn('!= "bridge"',guard);self.assertIn('!= "freeswitch"',guard);self.assertIn('!= "ring_all"',guard);self.assertIn('$var(did_target) == $null',guard);self.assertIn('$var(did_target) == ""',guard);self.assertIn('sl_send_reply("404", "Not Found");',guard);self.assertIn('exit;',guard)
 def test_numeric_callsite_and_variable_collision_refusals(self):
  with self.assertRaisesRegex(m.Refused,'DID_NUMERIC_CALLSITE_UNPROVEN'):apply(SOURCE.replace(b'[0-9]',b'.'))
  with self.assertRaisesRegex(m.Refused,'DID_NUMERIC_CALLSITE_UNPROVEN'):apply(SOURCE+b'route[OTHER] {route(DID_ROUTE);}')
  with self.assertRaisesRegex(m.Refused,'DID_NEW_VARIABLE_COLLISION'):apply(SOURCE.replace(b'    } else {',b'    } else {$var(api_body)="x";',1))
 def test_include_pin_and_other_direct_did_caller_refuse(self):
  a,b=pins(SOURCE)
  with patch.object(m,'EXPECTED_MAIN_SHA',a),patch.object(m,'EXPECTED_ROUTE_SHA',b),self.assertRaisesRegex(m.Refused,'DID_INCLUDE_SHA'):m.render(SOURCE,SECRET,b'wrong')
  other=b'route[OTHER] { route(DID_ROUTE); }'
  with patch.object(m,'EXPECTED_MAIN_SHA',a),patch.object(m,'EXPECTED_ROUTE_SHA',b),patch.object(m,'EXPECTED_INCLUDE_SHA',m.sha(other)),self.assertRaisesRegex(m.Refused,'DID_NUMERIC_CALLSITE_UNPROVEN'):m.render(SOURCE,SECRET,other)
 def test_no_port_or_connection_options_broadened(self):
  with self.assertRaisesRegex(m.Refused,'DID_BACKEND_BASE'):apply(SOURCE.replace(b':3000',b':3032'))
  with self.assertRaisesRegex(m.Refused,'DID_CONNECTION_BINDING'):apply(SOURCE.replace(b'backend=>BACKEND_URL',b'backend=>BACKEND_URL;username=unexpected'))
 def test_comment_normalizer_exact_provenance(self):
  source=Path('/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/pbx/voicemail-inbound-routing-oct24-v1/projections.py').read_text();start=source.index('def code(text):');end=source.index('\ndef kam(',start);expected=source[start:end];actual=(P/'transform.py').read_text();actual=actual[actual.index('def code(text):'):actual.index('\ndef mask(')];self.assertEqual('\n'.join(x for x in expected.splitlines()if not x.lstrip().startswith('#')).strip(),actual.strip())
 def test_balanced_quote_brace_prototype_and_finite_case_spec(self):
  x=apply().private_source.decode();clean=m.code(x);masked=m.mask(clean);self.assertEqual(masked.count('{'),masked.count('}'));self.assertEqual(masked.count('('),masked.count(')'));cases=json.loads((P/'ACCEPTANCE-CASES.json').read_text());self.assertFalse(cases['vendorRuntimeCasesExecuted']);self.assertEqual(len(cases['cases']),9)
if __name__=='__main__':unittest.main()
