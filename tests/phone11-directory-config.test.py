import hashlib
import importlib.util
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("directory_config", ROOT / "scripts/phone11-directory-config.py")
config = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(config)
SOURCE = (ROOT / "infra/configs/freeswitch/autoload_configs/xml_curl.conf.xml").read_bytes()
SECRET = 'synthetic-only:<>&"credential'


class DirectoryConfigTests(unittest.TestCase):
    def prepare(self, source=SOURCE, secret=SECRET):
        return config.prepare(source, hashlib.sha256(source).hexdigest(), secret)

    def test_only_directory_target_and_basic_change(self):
        result = self.prepare()
        root = ET.fromstring(result)
        bindings = root.findall("./bindings/binding")
        self.assertEqual([b.get("name") for b in bindings], ["directory"])
        params = {p.get("name"): p.get("value") for p in bindings[0].findall("param")}
        self.assertEqual(params["gateway-url"], config.URL)
        self.assertEqual(params["gateway-credentials"], config.USERNAME + ":" + SECRET)
        self.assertEqual(params["auth-scheme"], "=basic")
        self.assertEqual(result[result.index(b'<!-- Dialplan'):], SOURCE[SOURCE.index(b'<!-- Dialplan'):])
        self.assertNotIn(b"?secret=", params["gateway-url"].encode())

    def test_stale_source_and_existing_auth_refused(self):
        with self.assertRaisesRegex(config.Refused, "source_changed"):
            config.prepare(SOURCE, "0" * 64, SECRET)
        existing = SOURCE.replace(b'<param name="method"', b'<param name="auth-scheme" value="basic"/><param name="method"', 1)
        with self.assertRaisesRegex(config.Refused, "gateway_shape"):
            self.prepare(existing)

    def test_extra_active_binding_and_preprocessor_refused(self):
        for source in (
            SOURCE.replace(b"</bindings>", b'<binding name="dialplan"/></bindings>'),
            SOURCE.replace(b"<bindings>", b'<bindings><X-PRE-PROCESS cmd="include" data="other.xml"/>'),
        ):
            with self.assertRaises(config.Refused):
                self.prepare(source)

    def test_secret_cannot_inject_config_or_expand(self):
        result = self.prepare(secret='x' * 16 + '\"/><evil/>')
        self.assertEqual(len(ET.fromstring(result).findall(".//binding")), 1)
        for secret in ("short", "x" * 16 + "\n", "$${secret}", "x" * 16 + " ", "x" * 16 + "é"):
            with self.assertRaisesRegex(config.Refused, "credential_format"):
                self.prepare(secret=secret)


if __name__ == "__main__":
    unittest.main()
