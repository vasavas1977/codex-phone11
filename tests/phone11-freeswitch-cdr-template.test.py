"""Offline contracts only; never loads FreeSWITCH or reads private configuration."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('cdr_preflight', ROOT / 'scripts/phone11-freeswitch-cdr-preflight.py')
q = importlib.util.module_from_spec(spec)
spec.loader.exec_module(q)
TEMPLATE = ROOT / 'infra/configs/freeswitch/autoload_configs/xml_cdr.conf.xml'
SENTINEL = 'offline-only-secret-never-print-123456789'

def commissioned(**changes):
    root = ET.fromstring(TEMPLATE.read_bytes())
    settings = root.find('settings')
    values = {'url': q.ENDPOINT, 'cred': 'phone11-cdr:' + SENTINEL,
              'err-log-dir': '/etc/freeswitch/private-cdr/errors', **changes}
    for name, value in values.items():
        node = next((n for n in settings if n.get('name') == name), None)
        if node is None:
            node = ET.SubElement(settings, 'param', {'name': name})
        node.set('value', value)
    return ET.tostring(root)

class Contracts(unittest.TestCase):
    def test_stock_template_is_explicitly_uncommissioned_without_http_or_raw_file_logging(self):
        raw = TEMPLATE.read_bytes()
        params = {p.get('name'): p.get('value') for p in ET.fromstring(raw).find('settings')}
        self.assertEqual(params['url'], '')
        self.assertEqual(params['cred'], '')
        for name in ('log-dir', 'err-log-dir', 'http-header'):
            self.assertNotIn(name, params)
        self.assertNotIn(b'phone11-fs-secret-change-me', raw)
        self.assertIn(b'UNCOMMISSIONED', raw)
        self.assertIn(q.ENDPOINT.encode(), raw)
        with self.assertRaisesRegex(q.Refused, '^CDR_UNCOMMISSIONED$'):
            q.validate(raw)

    def test_private_commissioned_shape_is_static_evidence_only(self):
        self.assertEqual(q.validate(commissioned()), 'STATIC_CONFIG_PRESENT_RUNTIME_CUSTODY_UNPROVEN')

    def test_old_port_header_retry_timeout_and_public_spool_refuse(self):
        for changes in ({'url': 'http://127.0.0.1:3001/api/freeswitch/cdr'}, {'http-header': 'X-FS-Secret: ' + SENTINEL},
                        {'retries': '3'}, {'timeout': '0'}, {'err-log-dir': '/var/log/freeswitch/xml_cdr'},
                        {'cred': 'other:' + SENTINEL}, {'cred': 'phone11-cdr:change-me'}):
            with self.subTest(keys=list(changes)), self.assertRaises(q.Refused):
                q.validate(commissioned(**changes))

    def test_duplicate_and_entity_parameters_refuse(self):
        raw = commissioned()
        for bad in (raw.replace(b'</settings>', b'<param name="url" value="extra"/></settings>'), b'<!DOCTYPE x>' + raw):
            with self.assertRaisesRegex(q.Refused, '^CDR_CONFIGURATION_SHAPE$'):
                q.validate(bad)

    def test_cli_never_prints_secret_and_rejects_publicly_readable_private_config(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'private.xml'
            for mode, changes, expected in ((0o600, {}, 0), (0o644, {}, 70), (0o600, {'retries': '3'}, 70)):
                config.write_bytes(commissioned(**changes))
                os.chmod(config, mode)
                with contextlib.redirect_stdout(io.StringIO()) as output:
                    code = q.main(['--config', str(config)])
                self.assertEqual(code, expected)
                self.assertNotIn(SENTINEL, output.getvalue())
                self.assertFalse(json.loads(output.getvalue())['liveDeliveryProven'])

    def test_stock_deployment_refuses_unbound_private_mount_before_aws_or_mutations(self):
        source = (ROOT / 'infra/terraform/deploy.sh').read_text()
        gate = source.index('error "Legacy generic deployment is blocked:')
        self.assertLess(gate, source.index('aws sts get-caller-identity'))
        self.assertLess(gate, source.index('terraform init'))
        self.assertNotIn('PHONE11_CDR_CONFIG', source)
        self.assertIn('never add CDR credentials to tracked source', source)
        with contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(q.main(['--config', str(TEMPLATE)]), 70)
        self.assertEqual(json.loads(output.getvalue())['reason'], 'CDR_UNCOMMISSIONED')

if __name__ == '__main__':
    unittest.main()
