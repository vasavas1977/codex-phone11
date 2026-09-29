#!/usr/bin/env python3
"""Offline failure-path tests for the source-only EC2 candidate operators."""
import importlib.util
import json
from pathlib import Path
from unittest import TestCase, main, mock

ROOT = Path(__file__).resolve().parents[1]

def load(filename, name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    import sys
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

start = load("phone11-mainline-release-start.py", "test_mainline_start")
route = load("phone11-mainline-release-route.py", "test_mainline_route")


def pins():
    sha = "a" * 64
    return {
        "schema": start.SCHEMA,
        "predecessor": {"container_id": start.PREDECESSOR_ID, "image": start.PREDECESSOR_IMAGE,
                        "source_sha": start.PREDECESSOR_SOURCE, "bundle_sha256": start.PREDECESSOR_BUNDLE,
                        "runtime_sha256": sha},
        "baseline": {"container_id": "b" * 64, "image": start.BASELINE_IMAGE,
                     "runtime_sha256": sha, "build": "baseline", "role": "default"},
        "recovery": {"container_id": "c" * 64, "image": "sha256:" + "c" * 64,
                     "runtime_sha256": sha, "build": "recovery", "role": "api-candidate"},
        "candidate": {"image": "sha256:" + "e" * 64, "source_sha": "d" * 40,
                      "bundle_sha256": sha, "lock_sha256": sha, "build": "build-1",
                      "name": "cp11-api-candidate-release", "port": 3020},
        "nginx": {"site_path": str(start.SITE_ENABLED), "site_sha256": start.SITE_SHA,
                  "dump_sha256": start.NGINX_DUMP_SHA},
        "wake": {"config_path": str(start.WAKE_CONFIG), "config_sha256": sha, "reference_count": 4},
    }


class StartGuards(TestCase):
    def test_reviewed_manifest_shape_passes(self):
        record = pins()
        with mock.patch.object(start, "secure_file", return_value=json.dumps(record).encode()):
            self.assertEqual(start.manifest(Path("/root/reviewed.json")), record)

    def test_stale_predecessor_and_decoy_wake_refused_before_commands(self):
        cases = (("predecessor", "container_id", "f" * 64),
                 ("nginx", "site_sha256", "f" * 64),
                 ("wake", "config_path", "/tmp/decoy"))
        for section, key, value in cases:
            with self.subTest(section=section):
                record = pins()
                record[section][key] = value
                with mock.patch.object(start, "secure_file", return_value=json.dumps(record).encode()), \
                     mock.patch.object(start, "command") as command:
                    with self.assertRaises(start.Refused):
                        start.manifest(Path("/root/manifest.json"))
                    command.assert_not_called()

    def test_candidate_port_cannot_reuse_known_3017_or_3018(self):
        record = pins()
        for port in (3017, 3018):
            record["candidate"]["port"] = port
            # Those ports are presently occupied, so the socket guard must refuse.
            class Busy:
                def __enter__(self): return self
                def __exit__(self, *args): pass
                def settimeout(self, *args): pass
                def connect_ex(self, *args): return 0
            with mock.patch.object(start.subprocess, "run", return_value=mock.Mock(returncode=1, stderr=b"No such object")), \
                 mock.patch.object(start.socket, "socket", return_value=Busy()):
                with self.assertRaisesRegex(start.Refused, "candidate_port_busy"):
                    start.absent_target(record["candidate"]["name"], port)

    def test_worker_role_refused(self):
        item = {"Name": "/" + start.PREDECESSOR, "Id": start.PREDECESSOR_ID,
                "Image": start.PREDECESSOR_IMAGE, "State": {"Running": True, "Health": {"Status": "healthy"}},
                "Config": {"Env": ["PHONE11_RUNTIME_ROLE=default", "PORT=3016"]}}
        with mock.patch.object(start, "inspect", return_value=item), \
             mock.patch.object(start, "runtime_hash", return_value="a" * 64), \
             mock.patch.object(start, "health") as health:
            with self.assertRaisesRegex(start.Refused, "runtime_role"):
                start.pinned_container(start.PREDECESSOR, pins()["predecessor"], port=3016,
                                       build=start.PREDECESSOR_BUILD, role="api-candidate")
            health.assert_not_called()

    def test_image_default_additional_flag_refused_before_create(self):
        source = {"Config": {"User": "cloudphone", "Entrypoint": ["docker-entrypoint.sh"],
                             "Cmd": ["node", "dist/index.mjs"], "WorkingDir": "/app",
                             "Env": ["PHONE11_RUNTIME_ROLE=api-candidate", "PORT=3016"]}}
        c = pins()["candidate"]
        image = {"Id": c["image"], "Os": "linux", "Architecture": "amd64",
                 "Config": {**source["Config"], "Env": ["PHONE11_RUNTIME_ROLE=api-candidate", "PORT=3000", "PHONE11_WAKE_ENABLED=1"],
                            "Labels": {"com.phone11.source-sha": c["source_sha"],
                                       "com.phone11.bundle-sha256": c["bundle_sha256"],
                                       "com.phone11.lock-sha256": c["lock_sha256"],
                                       "com.phone11.candidate-build": c["build"],
                                       "com.phone11.runtime-role-guard": "api-candidate"}}}
        with mock.patch.object(start, "inspect", return_value=image):
            with self.assertRaisesRegex(start.Refused, "image_env_defaults"):
                start.candidate_image(pins(), source)

    def test_candidate_upstream_collision_refused(self):
        record = pins()
        dump = b"proxy_pass http://127.0.0.1:3020;"
        wake = start.WAKE_URL * 4
        def read(path): return b"site" if path == start.SITE_ENABLED else wake
        def command(*args, **kwargs): return dump if args == ("nginx", "-T") else (start.digest(wake) + "  config").encode()
        record["nginx"]["site_sha256"] = start.digest(b"site")
        record["nginx"]["dump_sha256"] = start.digest(dump)
        record["wake"]["config_sha256"] = start.digest(wake)
        with mock.patch.object(start, "secure_file", side_effect=read), mock.patch.object(start, "command", side_effect=command):
            with self.assertRaisesRegex(start.Refused, "candidate_upstream_collision"):
                start.site_and_wake(record, 3020)


class RouteGuards(TestCase):
    def setup_route(self):
        record = pins()
        before = b"before"
        after = b"after"
        receipt = {"candidate_id": "f" * 64, "fixture_sha256": "a" * 64,
                   "active_dump_sha256": start.digest(b"active-dump"), "rollback_fixture_sha256": "b" * 64, "state": "prepared"}
        return record, before, after, receipt

    def test_activate_reload_failure_restores_only_exact_site(self):
        record, before, after, receipt = self.setup_route()
        record["nginx"]["dump_sha256"] = start.digest(b"headbeforetail")
        current = [before]
        def site(expected=None):
            if expected is not None and expected != current[0]: raise route.start.Refused("site_drift")
            return current[0], mock.Mock(st_mode=0o644, st_uid=0, st_gid=0)
        def write(expected, replacement, info):
            if current[0] != expected: raise route.start.Refused("site_drift")
            current[0] = replacement
        count = [0]
        def reload():
            count[0] += 1
            if count[0] == 1: raise route.start.Refused("reload_failed")
        with mock.patch.object(route, "sealed", return_value=(receipt, before, after)), \
             mock.patch.object(route, "site", side_effect=site), \
             mock.patch.object(route, "write_site", side_effect=write), \
             mock.patch.object(route, "reload", side_effect=reload), \
             mock.patch.object(route, "protected"), mock.patch.object(route, "probes"), \
             mock.patch.object(route.start, "command", return_value=b"headbeforetail"):
            with self.assertRaisesRegex(route.start.Refused, "reload_failed"):
                route.activate(record, Path("/unused"), Path("/fixture"), "https://api.phone11.ai")
        self.assertEqual(current[0], before)
        self.assertEqual(count[0], 2)

    def test_activate_concurrent_site_drift_refuses_overwrite(self):
        record, before, after, receipt = self.setup_route()
        record["nginx"]["dump_sha256"] = start.digest(b"headbeforetail")
        def site(expected=None):
            if expected == before: return before, mock.Mock(st_mode=0o644, st_uid=0, st_gid=0)
            return b"third-party", mock.Mock(st_mode=0o644, st_uid=0, st_gid=0)
        with mock.patch.object(route, "sealed", return_value=(receipt, before, after)), \
             mock.patch.object(route, "site", side_effect=site), \
             mock.patch.object(route, "protected"), mock.patch.object(route, "probes"), \
             mock.patch.object(route, "write_site", side_effect=route.start.Refused("write_failed")) as write, \
             mock.patch.object(route, "reload") as reload, \
             mock.patch.object(route.start, "command", return_value=b"headbeforetail"):
            with self.assertRaisesRegex(route.start.Refused, "restore_requires_operator"):
                route.activate(record, Path("/unused"), Path("/fixture"), "https://api.phone11.ai")
        self.assertEqual(write.call_count, 1)
        reload.assert_not_called()

    def test_rollback_dump_drift_refuses_before_write(self):
        record, before, after, receipt = self.setup_route()
        with mock.patch.object(route, "sealed", return_value=(receipt, before, after)), \
             mock.patch.object(route.start, "command", return_value=b"different-dump"), \
             mock.patch.object(route, "write_site") as write:
            with self.assertRaisesRegex(route.start.Refused, "nginx_dump_drift"):
                route.rollback(record, Path("/unused"), Path("/fixture"), "https://api.phone11.ai")
            write.assert_not_called()

    def test_successful_activation_records_generation(self):
        record, before, after, receipt = self.setup_route()
        record["nginx"]["dump_sha256"] = start.digest(b"headbeforetail")
        current = [before]
        def site(expected=None):
            if expected is not None and expected != current[0]: raise route.start.Refused("site_drift")
            return current[0], mock.Mock(st_mode=0o644, st_uid=0, st_gid=0)
        def write(expected, replacement, info): current[0] = replacement
        outputs = iter((b"headbeforetail", b"headaftertail"))
        with mock.patch.object(route, "sealed", return_value=(receipt, before, after)), \
             mock.patch.object(route, "site", side_effect=site), \
             mock.patch.object(route, "write_site", side_effect=write), \
             mock.patch.object(route, "reload"), mock.patch.object(route, "protected"), \
             mock.patch.object(route, "probes") as probes, \
             mock.patch.object(route.old, "atomic_write") as write_receipt, \
             mock.patch.object(route.start, "command", side_effect=lambda *a: next(outputs)):
            route.activate(record, Path("/unused"), Path("/fixture"), "https://api.phone11.ai")
        self.assertEqual(current[0], after)
        self.assertEqual(probes.call_count, 2)
        self.assertEqual(receipt["state"], "active")
        self.assertEqual(receipt["active_dump_sha256"], start.digest(b"headaftertail"))
        write_receipt.assert_called_once()

    def test_probe_fixture_rejects_mutation_before_http(self):
        raw = b"fixture"
        values = [{"label": label, "method": "GET", "body": "", "path": path, "status": 403 if label == "denied_tenant" else 200}
                  for label, path in (("existing_phone", "/api/trpc/phone.getConfig"),
                                      ("existing_chat", "/api/trpc/chat.list"),
                                      ("conference", "/api/trpc/conference.list"),
                                      ("mixed_batch", "/api/trpc/phone.getConfig,chat.list?batch=1"),
                                      ("denied_tenant", "/api/trpc/phone.getConfig"))]
        values[2]["path"] = "/api/trpc/conference.create"
        with mock.patch.object(route, "root_file", return_value=raw), \
             mock.patch.object(route.pilot, "load_probes", return_value=values), \
             mock.patch.object(route.pilot, "run_probes") as http:
            with self.assertRaisesRegex(route.start.Refused, "probe_read_only"):
                route.probes(Path("/fixture"), route.start.digest(raw), "https://api.phone11.ai")
            http.assert_not_called()

    def test_rollback_candidate_down_keeps_predecessor_after_probe_failure(self):
        record, before, after, receipt = self.setup_route()
        record["nginx"]["dump_sha256"] = route.start.digest(b"headbeforetail")
        current = [after]
        def site(expected=None):
            if expected is not None and expected != current[0]: raise route.start.Refused("site_drift")
            return current[0], mock.Mock(st_mode=0o644, st_uid=0, st_gid=0)
        def write(expected, replacement, info): current[0] = replacement
        calls = []
        def protected(pins, candidate_id=None):
            calls.append(candidate_id)
            if candidate_id is not None: raise route.start.Refused("candidate_down")
        with mock.patch.object(route, "sealed", return_value=(receipt, before, after)), \
             mock.patch.object(route, "site", side_effect=site), \
             mock.patch.object(route, "write_site", side_effect=write), \
             mock.patch.object(route, "reload"), mock.patch.object(route, "protected", side_effect=protected), \
             mock.patch.object(route, "probes", side_effect=route.start.Refused("probe_failed")), \
             mock.patch.object(route.start, "command", side_effect=(b"active-dump", b"headbeforetail")):
            with self.assertRaisesRegex(route.start.Refused, "probe_failed"):
                route.rollback(record, Path("/unused"), Path("/fixture"), "https://api.phone11.ai")
        self.assertEqual(current[0], before)
        self.assertEqual(calls, [None])

    def test_unrelated_nginx_generation_change_restores_before(self):
        record, before, after, receipt = self.setup_route()
        record["nginx"]["dump_sha256"] = route.start.digest(b"headbeforetail")
        current = [before]
        def site(expected=None):
            if expected is not None and expected != current[0]: raise route.start.Refused("site_drift")
            return current[0], mock.Mock(st_mode=0o644, st_uid=0, st_gid=0)
        def write(expected, replacement, info): current[0] = replacement
        outputs = iter((b"headbeforetail", b"headaftertailextra"))
        with mock.patch.object(route, "sealed", return_value=(receipt, before, after)), \
             mock.patch.object(route, "site", side_effect=site), \
             mock.patch.object(route, "write_site", side_effect=write), \
             mock.patch.object(route, "reload"), mock.patch.object(route, "protected"), \
             mock.patch.object(route, "probes"), \
             mock.patch.object(route.start, "command", side_effect=lambda *a: next(outputs)):
            with self.assertRaisesRegex(route.start.Refused, "nginx_generation_drift"):
                route.activate(record, Path("/unused"), Path("/fixture"), "https://api.phone11.ai")
        self.assertEqual(current[0], before)

    def test_rollback_predecessor_down_never_writes_site(self):
        record, before, after, receipt = self.setup_route()
        with mock.patch.object(route, "sealed", return_value=(receipt, before, after)), \
             mock.patch.object(route, "site", return_value=(after, mock.Mock())), \
             mock.patch.object(route, "protected", side_effect=route.start.Refused("predecessor_down")), \
             mock.patch.object(route, "write_site") as write, \
             mock.patch.object(route, "reload") as reload, \
             mock.patch.object(route.start, "command", return_value=b"active-dump"):
            with self.assertRaisesRegex(route.start.Refused, "predecessor_down"):
                route.rollback(record, Path("/unused"), Path("/fixture"), "https://api.phone11.ai")
            write.assert_not_called()
            reload.assert_not_called()

    def test_recover_interrupted_activation_restores_3016(self):
        record, before, after, receipt = self.setup_route()
        record["nginx"]["dump_sha256"] = route.start.digest(b"headbeforetail")
        current = [after]
        def site(expected=None):
            if expected is not None and expected != current[0]: raise route.start.Refused("site_drift")
            return current[0], mock.Mock(st_mode=0o644, st_uid=0, st_gid=0)
        def write(expected, replacement, info): current[0] = replacement
        with mock.patch.object(route, "root_file", return_value=b'{"state":"prepared"}'), \
             mock.patch.object(route, "sealed", return_value=(receipt, before, after)), \
             mock.patch.object(route, "site", side_effect=site), \
             mock.patch.object(route, "write_site", side_effect=write), \
             mock.patch.object(route, "reload"), mock.patch.object(route, "protected") as protected, \
             mock.patch.object(route, "probes"), \
             mock.patch.object(route.old, "atomic_write") as receipt_write, \
             mock.patch.object(route.start, "command", side_effect=(b"headaftertail", b"headbeforetail")):
            route.recover(record, route.ROOT / "receipt", Path("/fixture"), "https://api.phone11.ai")
        self.assertEqual(current[0], before)
        self.assertEqual(receipt["state"], "aborted")
        self.assertEqual(protected.call_count, 2)
        receipt_write.assert_called_once()

    def test_recover_interrupted_rollback_reconciles_receipt(self):
        record, before, after, receipt = self.setup_route()
        receipt["state"] = "active"
        record["nginx"]["dump_sha256"] = route.start.digest(b"headbeforetail")
        with mock.patch.object(route, "root_file", return_value=b'{"state":"active"}'), \
             mock.patch.object(route, "sealed", return_value=(receipt, before, after)), \
             mock.patch.object(route, "site", return_value=(before, mock.Mock())), \
             mock.patch.object(route, "protected"), mock.patch.object(route, "probes"), \
             mock.patch.object(route, "write_site") as write, \
             mock.patch.object(route, "reload") as reload, \
             mock.patch.object(route.old, "atomic_write") as receipt_write, \
             mock.patch.object(route.start, "command", return_value=b"headbeforetail"):
            route.recover(record, route.ROOT / "receipt", Path("/fixture"), "https://api.phone11.ai")
        self.assertEqual(receipt["state"], "rolled_back")
        write.assert_not_called()
        reload.assert_called_once()
        receipt_write.assert_called_once()

    def test_prepare_activate_rollback_control_flow(self):
        from tempfile import TemporaryDirectory
        record = pins()
        before = (b"location = /api/trpc {\n  proxy_pass http://127.0.0.1:3016;\n}\n"
                  b"location ^~ /api/trpc/ {\n  proxy_pass http://127.0.0.1:3016;\n}\n")
        after = route.old.rewrite_trpc(before, 3016, record["candidate"]["port"])
        record["nginx"]["site_sha256"] = route.start.digest(before)
        record["nginx"]["dump_sha256"] = route.start.digest(b"head" + before + b"tail")
        current = [before]
        files = {}
        candidate_id = "f" * 64
        def site(expected=None):
            if expected is not None and current[0] != expected: raise route.start.Refused("site_drift")
            return current[0], mock.Mock(st_mode=0o644, st_uid=0, st_gid=0)
        def write(expected, replacement, info):
            if current[0] != expected: raise route.start.Refused("site_drift")
            current[0] = replacement
        def atomic(path, raw, **kwargs): files[str(path)] = raw
        def sealed(directory, state, pins):
            receipt = json.loads(files[str(directory / "receipt.json")])
            self.assertEqual(receipt["state"], state)
            return receipt, files[str(directory / "site.before")], files[str(directory / "site.active")]
        def nginx(*args): return b"head" + current[0] + b"tail"
        with TemporaryDirectory() as tmp, \
             mock.patch.object(route, "ROOT", Path(tmp)), \
             mock.patch.object(route, "root_dir"), \
             mock.patch.object(route, "start_receipt", return_value=candidate_id), \
             mock.patch.object(route.start, "site_and_wake"), \
             mock.patch.object(route, "protected"), \
             mock.patch.object(route, "probes") as probes, \
             mock.patch.object(route, "site", side_effect=site), \
             mock.patch.object(route, "write_site", side_effect=write), \
             mock.patch.object(route, "reload"), \
             mock.patch.object(route, "sealed", side_effect=sealed), \
             mock.patch.object(route.old, "atomic_write", side_effect=atomic), \
             mock.patch.object(route.start, "command", side_effect=nginx):
            directory = route.prepare(record, Path("/start.json"), Path("/candidate-probes"),
                                      "a" * 64, Path("/rollback-probes"), "b" * 64)
            route.activate(record, directory, Path("/candidate-probes"), "https://api.phone11.ai")
            self.assertEqual(current[0], after)
            route.rollback(record, directory, Path("/rollback-probes"), "https://api.phone11.ai")
            self.assertEqual(current[0], before)
            self.assertEqual(json.loads(files[str(directory / "receipt.json")])["state"], "rolled_back")
            self.assertEqual(probes.call_count, 5)


if __name__ == "__main__":
    main()
