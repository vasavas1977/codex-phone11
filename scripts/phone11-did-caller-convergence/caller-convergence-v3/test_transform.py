import hashlib
import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

P = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('did_v3', P / 'transform.py')
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)
spec = importlib.util.spec_from_file_location('did_v3_fixture', P.parent / 'caller-convergence-v1/test_transform.py')
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)
SOURCE = f.SOURCE.replace(b'^[0-9]+$', b'^[1-9][0-9]{3}$')
SECRET = 'a4' * 32


def render(source=SOURCE, secret=SECRET):
    clean = m.v2.v1.code(source.decode())
    a, b = m.v2.v1.route_span(clean)
    left, right = m.v2.consumer_span(clean)
    with patch.object(m.v2.v1, 'EXPECTED_MAIN_SHA', m.v2.v1.sha(source)), \
         patch.object(m.v2.v1, 'EXPECTED_ROUTE_SHA', m.v2.v1.sha(clean[a:b].encode())), \
         patch.object(m.v2.v1, 'EXPECTED_INCLUDE_SHA', m.v2.v1.sha(f.INCLUDE)), \
         patch.object(m.v2, 'CONSUMER_SHA', m.v2.v1.sha(clean[left:right].encode())):
        return m.render(source, secret, f.INCLUDE)


class DedicatedReceiver(unittest.TestCase):
    def test_immutable_predecessor_and_real_input_pin(self):
        self.assertEqual(hashlib.sha256(m.V2.read_bytes()).hexdigest(), m.V2_SHA)
        with self.assertRaisesRegex(m.Refused, 'DID_MAIN_SHA'):
            m.render(SOURCE, SECRET, f.INCLUDE)

    def test_dedicated_secret_and_url_only_inside_did_route(self):
        result = render()
        text = result.private_source.decode()
        a, b = m.v2.v1.route_span(m.v2.v1.code(text))
        self.assertEqual(text[:a], f.PREFIX)
        self.assertEqual(text[b:], '\nroute[UNRELATED] { exit; }\n')
        self.assertIn(m.ENDPOINT, text[a:b])
        self.assertIn('x-kam-secret: ' + SECRET, text[a:b])
        self.assertNotIn('KAM_SECRET', text[a:b])
        self.assertNotIn('BACKEND_URL', text[a:b])
        self.assertNotIn(f.SECRET, text[a:b])
        self.assertNotIn(SECRET, repr(result))
        self.assertFalse(result.old_backend_secret_equality_proven)
        self.assertFalse(result.execution_eligible)

    def test_invalid_secret_refuses_without_secret_in_error(self):
        for secret in [None, '', 'a' * 63, 'a' * 65, 'A' * 64, 'a' * 62 + '\r\n', 'a' * 63 + '"']:
            with self.assertRaisesRegex(m.Refused, '^DID_DEDICATED_SECRET_SHAPE$'):
                render(secret=secret)

    def test_reusing_source_secret_refused(self):
        source = SOURCE.replace(f.SECRET.encode(), SECRET.encode())
        with self.assertRaisesRegex(m.Refused, '^DID_DEDICATED_SECRET_REUSE$'):
            render(source)

    def test_new_cache_generation_and_preserved_target_admission(self):
        text = render().private_source.decode()
        self.assertIn('"phone11_did_v3:"', text)
        self.assertNotIn('"phone11_did_v2:"', text)
        self.assertIn('$ru = $var(did_target);', text)
        self.assertIn(m.v2.SIP_PATTERN, text)
        self.assertIn(m.v2.INTERNAL_PATTERN, text)
        self.assertIn('if ($var(phone11_did_action) == "reject")', text)
        self.assertNotIn('htable.flush', text)

    def test_legacy_placeholder_is_only_source_syntax(self):
        source = SOURCE.replace(f.SECRET.encode(), b'placeholder')
        result = render(source)
        a, b = m.v2.v1.route_span(m.v2.v1.code(result.private_source.decode()))
        self.assertNotIn(b'placeholder', result.private_source[a:b])
        self.assertFalse(result.old_backend_secret_equality_proven)

    def test_malformed_legacy_literal_still_refused(self):
        for value in [b'bad secret', b'bad;secret', b'bad$secret', b'bad\\secret']:
            with self.assertRaises(m.Refused):
                render(SOURCE.replace(f.SECRET.encode(), value))

    def test_derived_predecessor_has_one_deliberate_validation_delta(self):
        old = (P.parent / 'caller-convergence-v1/transform.py').read_text()
        before = "need(type(backend_secret)is str and re.fullmatch(r'[A-Za-z0-9._~+/-]{24,256}={0,2}',secret)and not re.search('change[-_ ]?me|example|placeholder',secret,re.I),'DID_SECRET_SHAPE')"
        after = "# Dedicated receiver mode: this is captured source syntax, not a live credential.\n need(type(backend_secret)is str and re.fullmatch(r'[A-Za-z0-9._~+/-]{1,256}={0,2}',secret),'DID_SOURCE_LITERAL_BOUND')"
        self.assertEqual((P / 'request_transform.py').read_text(), old.replace(before, after))

    def test_no_ambient_environment_read_or_secret_generation(self):
        with patch.dict('os.environ', {'KAM_SHARED_SECRET': 'wrong', 'BACKEND_URL': 'https://untrusted.invalid'}, clear=False):
            self.assertEqual(render().private_source, render().private_source)
        text = (P / 'transform.py').read_text()
        self.assertNotIn('os.environ', text)
        self.assertNotIn('secrets.', text)


if __name__ == '__main__':
    unittest.main()
