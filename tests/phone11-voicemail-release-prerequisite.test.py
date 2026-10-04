#!/usr/bin/env python3
"""Offline private-file and caller-evidence refusal checks; no runtime access."""
import copy
import importlib.util
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, main, mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("prerequisite_test", ROOT / "scripts/phone11-voicemail-release-prerequisite.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
NOW = 1_791_151_200.0


def fixture():
    candidate = {"image": "sha256:" + "e" * 64, "source_sha": "d" * 40, "bundle_sha256": "a" * 64,
                 "lock_sha256": "b" * 64, "build": "release", "name": "cp11-api-candidate-release",
                 "port": 3020, "node_version": "22.23.3"}
    backend = {"name": "cp11-api-candidate-sip-consistency", "container_id": "b" * 64,
               "image": "sha256:" + "c" * 64, "runtime_sha256": "d" * 64, "hook_ready": False}
    freeswitch = {"name": "p11-freeswitch", "container_id": "f" * 64, "image": "sha256:" + "f" * 64,
                  "runtime_sha256": "a" * 64, "hook_ready": False}
    config = b'<configuration name="modules.conf"><modules><load module="mod_lua"/></modules></configuration>'
    record = {"schema": gate.SCHEMA, "evidence_source": "caller_attestation",
              "observed_at": gate.datetime.fromtimestamp(NOW, gate.timezone.utc).isoformat(),
              "reviewed_helper_revision": gate.REVIEWED_REVISION, "candidate": candidate,
              "backend": backend, "freeswitch": freeswitch,
              "helpers": {name: {"readable": True, "sha256": digest} for name, digest in gate.HELPERS.items()},
              "lua": {"module_probe_exit": 0, "module_exists": True, "modules_config_sha256": gate.sha(config)}}
    return record, {"candidate": candidate, "predecessor": backend}, config


class EvidenceChecks(TestCase):
    def test_fresh_exact_flag_off_evidence_passes_without_authority_claim(self):
        record, pins, _ = fixture()
        gate.validate(record, pins, NOW + 60)
        self.assertEqual(record["evidence_source"], "caller_attestation")

    def test_unsafe_missing_or_inconsistent_fields_refuse(self):
        cases = [("schema", "other"), ("evidence_source", "verified_runtime"),
                 ("reviewed_helper_revision", "a" * 40), ("candidate", {}),
                 ("backend.name", "decoy"), ("backend.container_id", "a" * 64),
                 ("backend.image", "sha256:" + "a" * 64), ("backend.runtime_sha256", "a" * 64),
                 ("backend.hook_ready", True), ("backend.hook_ready", None),
                 ("freeswitch.name", "decoy"), ("freeswitch.container_id", "b" * 64),
                 ("freeswitch.image", "latest"), ("freeswitch.hook_ready", True),
                 ("lua.module_probe_exit", 255), ("lua.module_probe_exit", False),
                 ("lua.module_exists", False), ("lua.module_exists", None),
                 ("lua.modules_config_sha256", "bad"), ("observed_at", "2026-10-05")]
        for path, replacement in cases:
            with self.subTest(path=path, replacement=replacement):
                record, pins, _ = fixture()
                # Expected pins must not share mutable evidence containers.
                pins = copy.deepcopy(pins)
                keys = path.split(".")
                destination = record
                for key in keys[:-1]:
                    destination = destination[key]
                destination[keys[-1]] = replacement
                with self.assertRaises(gate.Refused):
                    gate.validate(record, pins, NOW)
        for key in fixture()[0]:
            record, pins, _ = fixture()
            del record[key]
            with self.subTest(missing=key), self.assertRaises(gate.Refused):
                gate.validate(record, pins, NOW)

    def test_stale_future_and_invalid_times_refuse(self):
        for delta in (901, -1, float("nan"), float("inf")):
            record, pins, _ = fixture()
            with self.subTest(delta=delta), self.assertRaises(gate.Refused):
                gate.validate(record, pins, NOW + delta)
        record, pins, _ = fixture()
        record["observed_at"] = "2026-99-01T00:00:00Z"
        with self.assertRaises(gate.Refused):
            gate.validate(record, pins, NOW)

    def test_helper_digest_readability_duplicates_and_extra_fields_refuse(self):
        for name in gate.HELPERS:
            for key, value in (("sha256", "f" * 64), ("readable", False), ("readable", None), ("extra", True)):
                record, pins, _ = fixture()
                record["helpers"][name][key] = value
                with self.subTest(name=name, key=key), self.assertRaises(gate.Refused):
                    gate.validate(record, pins, NOW)
        with self.assertRaises(gate.Refused):
            gate.no_duplicate_keys([("schema", "one"), ("schema", "two")])

    def test_lua_configuration_requires_resolved_single_active_load(self):
        gate.modules_config(fixture()[2])
        cases = [b"invalid", b'<configuration name="other"><modules><load module="mod_lua"/></modules></configuration>',
                 b'<configuration name="modules.conf"><modules><!--load module="mod_lua"/--></modules></configuration>',
                 b'<configuration name="modules.conf"><modules><load module="mod_lua"/><load module="mod_lua"/></modules></configuration>',
                 b'<configuration name="modules.conf"><modules><load module="mod_lua"/><X-PRE-PROCESS cmd="include"/></modules></configuration>',
                 b'<!DOCTYPE configuration [<!ENTITY load "x">]><configuration name="modules.conf"><modules><load module="mod_lua"/></modules></configuration>',
                 b'<configuration name="modules.conf"><modules enabled="yes"><load module="mod_lua"/></modules></configuration>',
                 b'<configuration name="modules.conf"><modules><load module="mod_lua" disabled="false"/></modules></configuration>',
                 b'<configuration xmlns="urn:unsupported" name="modules.conf"><modules><load module="mod_lua"/></modules></configuration>']
        for raw in cases:
            with self.subTest(raw=raw), self.assertRaises(gate.Refused):
                gate.modules_config(raw)

    def test_wide_encoded_dtd_and_entity_directives_refuse(self):
        declarations = ('<!DOCTYPE configuration>',
                        '<!DOCTYPE configuration [<!ENTITY module "mod_lua">]>')
        for codec, xml_encoding in (("utf-16", "UTF-16"), ("utf-16-le", "UTF-16"), ("utf-16-be", "UTF-16"),
                                    ("utf-32", "UTF-32"), ("utf-32-le", "UTF-32"), ("utf-32-be", "UTF-32")):
            for declaration in declarations:
                module = "&module;" if "ENTITY" in declaration else "mod_lua"
                xml = (f'<?xml version="1.0" encoding="{xml_encoding}"?>{declaration}'
                       f'<configuration name="modules.conf"><modules><load module="{module}"/></modules></configuration>')
                with self.subTest(codec=codec, declaration=declaration), self.assertRaises(gate.Refused):
                    gate.modules_config(xml.encode(codec))

    def test_wide_encoded_processing_instructions_and_plain_config_refuse(self):
        for codec, xml_encoding in (("utf-16", "UTF-16"), ("utf-16-le", "UTF-16"), ("utf-16-be", "UTF-16"),
                                    ("utf-32", "UTF-32"), ("utf-32-le", "UTF-32"), ("utf-32-be", "UTF-32")):
            for instruction in ("", '<?include file="modules-extra.xml"?>'):
                xml = (f'<?xml version="1.0" encoding="{xml_encoding}"?>{instruction}'
                       '<configuration name="modules.conf"><modules><load module="mod_lua"/></modules></configuration>')
                with self.subTest(codec=codec, instruction=instruction), self.assertRaises(gate.Refused):
                    gate.modules_config(xml.encode(codec))

    def test_utf8_and_ascii_config_remain_accepted(self):
        config = fixture()[2]
        for declaration in (b'', b'<?xml version="1.0" encoding="UTF-8"?>',
                            b'<?xml version="1.0" encoding="US-ASCII"?>',
                            b'<?xml version="1.0" encoding="ASCII"?>',
                            b'\xef\xbb\xbf<?xml version="1.0" encoding="UTF-8"?>'):
            with self.subTest(declaration=declaration):
                gate.modules_config(declaration + config)
        gate.modules_config(b'<?xml version="1.0" encoding="UTF-8"?>' + '<!--ภาษาไทย-->'.encode("utf-8") + config)

    def test_invalid_utf8_nul_and_contradictory_declarations_refuse(self):
        config = fixture()[2]
        cases = [b'\xff' + config, b'\x00' + config,
                 b'<?xml version="1.0" encoding="UTF-16"?>' + config,
                 b'<?xml version="1.0" encoding="UTF-32"?>' + config,
                 b'<?xml version="1.0" encoding="ISO-8859-1"?>' + config,
                 b'<?xml version="1.0" encoding="US-ASCII"?>' + '<!--ภาษาไทย-->'.encode("utf-8") + config]
        for raw in cases:
            with self.subTest(raw=raw), self.assertRaises(gate.Refused):
                gate.modules_config(raw)


class PrivateFileChecks(TestCase):
    def setUp(self):
        # Use a protected checkout parent; globally writable /tmp is deliberately refused.
        self.directory = TemporaryDirectory(dir=ROOT)
        self.root = Path(self.directory.name).resolve()
        self.uid, self.gid = os.getuid(), os.getgid()
        self.path = self.root / "evidence.json"
        self.write(self.path, b'{}')

    def tearDown(self):
        self.directory.cleanup()

    def write(self, path, raw):
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        path.write_bytes(raw)
        path.chmod(0o600)

    def read(self, path=None):
        return gate.protected_file(path or self.path, private=True, uid=self.uid, gid=self.gid)

    def test_private_regular_single_link_file_passes(self):
        self.assertEqual(self.read(), b'{}')

    def test_modes_owner_hardlink_symlink_and_fifo_refuse(self):
        self.path.chmod(0o644)
        with self.assertRaises(gate.Refused): self.read()
        self.path.chmod(0o600)
        with self.assertRaises(gate.Refused):
            gate.protected_file(self.path, private=True, uid=self.uid + 1, gid=self.gid)
        linked = self.root / "linked"
        os.link(self.path, linked)
        with self.assertRaises(gate.Refused): self.read()
        linked.unlink()
        linked.symlink_to(self.path)
        with self.assertRaises(gate.Refused): self.read(linked)
        linked.unlink()
        os.mkfifo(linked, 0o600)
        with self.assertRaises(gate.Refused): self.read(linked)

    def test_parent_symlink_and_writable_directory_refuse(self):
        snapshot = self.root / "snapshot"
        self.write(snapshot / "file", b"bytes")
        link = self.root / "link"
        link.symlink_to(snapshot, target_is_directory=True)
        with self.assertRaises(gate.Refused): self.read(link / "file")
        snapshot.chmod(0o777)
        with self.assertRaises(gate.Refused): self.read(snapshot / "file")

    def test_oversized_missing_and_relative_refuse(self):
        self.path.write_bytes(b"x" * (gate.MAX_SIZE + 1))
        with self.assertRaises(gate.Refused): self.read()
        with self.assertRaises(gate.Refused): self.read(self.root / "missing")
        with self.assertRaises(gate.Refused): self.read(Path("relative"))

    def test_changed_inode_metadata_during_read_refuses(self):
        original_read = gate.os.read
        def changed(fd, count):
            raw = original_read(fd, count)
            os.chmod(self.path, 0o640)
            return raw
        with mock.patch.object(gate.os, "read", side_effect=changed), self.assertRaises(gate.Refused):
            self.read()

    def packet(self):
        record, pins, config = fixture()
        self.write(self.path, json.dumps(record).encode())
        for name in gate.HELPERS:
            self.write(self.root / "snapshot" / name, (ROOT / "deploy/freeswitch/scripts" / name).read_bytes())
        self.write(self.root / "snapshot/modules.conf.xml", config)
        return pins

    def test_real_source_and_private_snapshot_bytes_are_bound(self):
        pins = self.packet()
        record, digest = gate.read_prerequisite(self.path, ROOT, pins, now=NOW, uid=self.uid, gid=self.gid)
        self.assertEqual(digest, gate.sha(self.path.read_bytes()))
        self.assertEqual(record["candidate"], pins["candidate"])
        self.write(self.root / "snapshot/phone11_legacy_voicemail.lua", b"old helper")
        with self.assertRaisesRegex(gate.Refused, "snapshot_helper"):
            gate.read_prerequisite(self.path, ROOT, pins, now=NOW, uid=self.uid, gid=self.gid)

    def test_source_drift_missing_helper_and_config_drift_refuse(self):
        pins = self.packet()
        source = self.root / "source"
        for tree in ("deploy/freeswitch/scripts", "infra/configs/freeswitch/scripts"):
            for name in gate.HELPERS:
                self.write(source / tree / name, (ROOT / tree / name).read_bytes())
        (source / "infra/configs/freeswitch/scripts/phone11_voicemail_deposit.lua").write_bytes(b"drift")
        with self.assertRaisesRegex(gate.Refused, "source_helper"):
            gate.read_prerequisite(self.path, source, pins, now=NOW, uid=self.uid, gid=self.gid)
        self.write(self.root / "snapshot/modules.conf.xml", b"drift")
        with self.assertRaisesRegex(gate.Refused, "configuration_mismatch"):
            gate.read_prerequisite(self.path, ROOT, pins, now=NOW, uid=self.uid, gid=self.gid)
        (self.root / "snapshot/phone11_voicemail_deposit.lua").unlink()
        with self.assertRaises(gate.Refused):
            gate.read_prerequisite(self.path, ROOT, pins, now=NOW, uid=self.uid, gid=self.gid)

    def test_json_duplicate_or_invalid_bytes_refuse(self):
        for raw in (b'{"schema":"one","schema":"two"}', b'{', b'\xff'):
            self.write(self.path, raw)
            with self.subTest(raw=raw), self.assertRaises(gate.Refused):
                gate.read_prerequisite(self.path, ROOT, fixture()[1], now=NOW, uid=self.uid, gid=self.gid)


if __name__ == "__main__":
    main()
