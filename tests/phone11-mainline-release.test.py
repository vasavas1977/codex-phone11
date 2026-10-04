#!/usr/bin/env python3
"""Offline failure-path tests for the source-only EC2 candidate operators."""
import importlib.util
from contextlib import ExitStack
import json
from pathlib import Path
import stat
from types import SimpleNamespace
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
                        "runtime_sha256": sha, "node_version": "22.22.3"},
        "baseline": {"container_id": "b" * 64, "image": start.BASELINE_IMAGE,
                     "runtime_sha256": sha, "build": "baseline", "role": "default"},
        "recovery": {"container_id": "c" * 64, "image": "sha256:" + "c" * 64,
                     "runtime_sha256": sha, "build": "recovery", "role": "api-candidate"},
        "candidate": {"image": "sha256:" + "e" * 64, "source_sha": "d" * 40,
                      "bundle_sha256": sha, "lock_sha256": sha, "build": "build-1",
                      "name": "cp11-api-candidate-release", "port": 3020, "node_version": "22.23.3"},
        "nginx": {"site_path": str(start.SITE_ENABLED), "site_sha256": start.SITE_SHA,
                  "dump_sha256": start.NGINX_DUMP_SHA},
        "wake": {"config_path": str(start.WAKE_CONFIG), "config_sha256": start.WAKE_CONFIG_SHA,
                 "reference_count": start.WAKE_REFERENCE_COUNT},
    }


def wake_container(mounts=None):
    if mounts is None:
        mounts = [{"Type": "bind", "Source": str(start.WAKE_CONFIG.parent),
                   "Destination": str(start.WAKE_RUNTIME_CONFIG.parent)}]
    return {"Name": "/" + start.WAKE_CONTAINER, "Id": start.WAKE_CONTAINER_ID,
            "Image": start.WAKE_IMAGE, "State": {"Running": True, "Health": None},
            "Mounts": mounts}


class StartGuards(TestCase):
    def test_legacy_baseline_health_omits_role_but_candidate_remains_strict(self):
        response = mock.Mock(status=200)
        connection = mock.Mock()
        connection.getresponse.return_value = response
        with mock.patch.object(start.http.client, "HTTPConnection", return_value=connection):
            response.read.return_value = b'{"ok":true,"service":"phone11-backend","build":"baseline"}'
            start.health(3000, "baseline", "default", legacy_default=True)
            with self.assertRaisesRegex(start.Refused, "health_identity"):
                start.health(3019, "baseline", "api-candidate")
            response.read.return_value = b'{"ok":true,"service":"phone11-backend","build":"baseline","runtimeRole":"api-candidate"}'
            with self.assertRaisesRegex(start.Refused, "health_identity"):
                start.health(3000, "baseline", "default", legacy_default=True)

    def test_observed_wake_topology_is_pinned(self):
        self.assertEqual(start.WAKE_CONFIG, Path("/opt/phone11ai/cloudphone11/infra/configs/kamailio/kamailio.cfg"))
        self.assertEqual(start.WAKE_RUNTIME_CONFIG, Path("/etc/kamailio/kamailio.cfg"))
        self.assertEqual(start.WAKE_URL, b"http://127.0.0.1:3018/api/phone11/wake")
        self.assertEqual(start.WAKE_CONFIG_SHA, "f4716d3b48e8f59ae863926cc6390f61b8a0d3b67b1732b484b6f7f23fb25d0a")
        self.assertEqual(start.WAKE_REFERENCE_COUNT, 1)
        self.assertEqual(start.WAKE_CONTAINER_ID, "ae72519b1e2f7fbc500dd92b14569362b073dbc9614c99da6ef3ba41567a99df")
        self.assertEqual(start.WAKE_IMAGE, "sha256:f7c3a2412b49f1372c70b2ad06da6f28cb34a044ee3ae408c7b960ef484bb5b7")

    def test_reviewed_manifest_shape_passes(self):
        record = pins()
        with mock.patch.object(start, "secure_file", return_value=json.dumps(record).encode()):
            self.assertEqual(start.manifest(Path("/root/reviewed.json")), record)

    def test_stale_predecessor_and_decoy_wake_refused_before_commands(self):
        cases = (("predecessor", "container_id", "f" * 64),
                 ("nginx", "site_sha256", "f" * 64),
                 ("wake", "config_path", "/tmp/decoy"),
                 ("wake", "config_sha256", "f" * 64),
                 ("wake", "reference_count", 4))
        for section, key, value in cases:
            with self.subTest(section=section):
                record = pins()
                record[section][key] = value
                with mock.patch.object(start, "secure_file", return_value=json.dumps(record).encode()), \
                     mock.patch.object(start, "command") as command:
                    with self.assertRaises(start.Refused):
                        start.manifest(Path("/root/manifest.json"))
                    command.assert_not_called()

    def test_manifest_refuses_wake_port_even_when_unoccupied(self):
        record = pins()
        record["candidate"]["port"] = 3018
        with mock.patch.object(start, "secure_file", return_value=json.dumps(record).encode()), \
             mock.patch.object(start, "command") as command, \
             mock.patch.object(start.socket, "socket") as socket:
            with self.assertRaisesRegex(start.Refused, "candidate_port"):
                start.manifest(Path("/root/reviewed.json"))
            command.assert_not_called()
            socket.assert_not_called()

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
                             "Env": ["PHONE11_RUNTIME_ROLE=api-candidate", "PORT=3016", "NODE_VERSION=22.22.3"]}}
        c = pins()["candidate"]
        image = {"Id": c["image"], "Os": "linux", "Architecture": "amd64",
                 "Config": {**source["Config"], "Env": ["PHONE11_RUNTIME_ROLE=api-candidate", "PORT=3000", "NODE_VERSION=22.23.3", "PHONE11_WAKE_ENABLED=1"],
                            "Labels": {"com.phone11.source-sha": c["source_sha"],
                                       "com.phone11.bundle-sha256": c["bundle_sha256"],
                                       "com.phone11.lock-sha256": c["lock_sha256"],
                                       "com.phone11.candidate-build": c["build"],
                                       "com.phone11.runtime-role-guard": "api-candidate"}}}
        with mock.patch.object(start, "inspect", return_value=image):
            with self.assertRaisesRegex(start.Refused, "image_env_defaults"):
                start.candidate_image(pins(), source)
            image["Config"]["Env"].remove("PHONE11_WAKE_ENABLED=1")
            start.candidate_image(pins(), source)
            image["Config"]["Env"].remove("NODE_VERSION=22.23.3")
            image["Config"]["Env"].append("NODE_VERSION=23.0.0")
            with self.assertRaisesRegex(start.Refused, "image_node_version"):
                start.candidate_image(pins(), source)

    def test_candidate_accepts_docker_empty_device_normalization_only(self):
        record = pins()
        candidate = record["candidate"]
        created = "f" * 64
        source_host = {key: None for key in ("NetworkMode", "Memory", "NanoCpus", "ReadonlyRootfs",
                                               "Privileged", "CapAdd", "CapDrop", "SecurityOpt", "Devices", "PidMode", "IpcMode")}
        source_host.update(NetworkMode="test-network", Memory=1024, ReadonlyRootfs=False, Privileged=False)
        host = {**source_host, "Devices": [], "PortBindings": {"3020/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3020"}]}}
        source = {"Config": {"Env": ["PHONE11_RUNTIME_ROLE=api-candidate", "PORT=3016", "NODE_VERSION=22.22.3"]},
                  "HostConfig": source_host, "Mounts": []}
        labels = {"com.phone11.source-sha": candidate["source_sha"],
                  "com.phone11.bundle-sha256": candidate["bundle_sha256"],
                  "com.phone11.lock-sha256": candidate["lock_sha256"],
                  "com.phone11.candidate-build": candidate["build"],
                  "com.phone11.runtime-role-guard": "api-candidate"}
        item = {"Name": "/" + candidate["name"], "Id": created, "Image": candidate["image"],
                "State": {"Running": True, "Health": {"Status": "healthy"}},
                "Config": {"Env": ["PHONE11_RUNTIME_ROLE=api-candidate", "PORT=3020",
                                   "NODE_VERSION=22.23.3", "PHONE11_BUILD_SHA=build-1"],
                           "Healthcheck": {"Test": ["CMD-SHELL", start.health_command(3020, "build-1")]},
                           "Labels": labels},
                "HostConfig": host, "NetworkSettings": {"Ports": host["PortBindings"]}, "Mounts": []}
        with mock.patch.object(start, "inspect", return_value=item), \
             mock.patch.object(start, "command", return_value=(candidate["bundle_sha256"] + "  /app/dist/index.mjs").encode()), \
             mock.patch.object(start, "health"):
            start.check_candidate(record, source, created)
            host["Devices"] = [{"PathOnHost": "/dev/sda"}]
            with self.assertRaisesRegex(start.Refused, "candidate_isolation"):
                start.check_candidate(record, source, created)

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

    def test_wake_guard_reads_host_bind_and_hashes_container_config(self):
        record = pins()
        wake = b'url="' + start.WAKE_URL + b'"'
        record["wake"]["config_sha256"] = start.digest(wake)
        with mock.patch.object(start, "secure_file", return_value=wake) as read, \
             mock.patch.object(start, "inspect", return_value=wake_container()) as inspect, \
             mock.patch.object(start, "command", return_value=(start.digest(wake) + "  " + str(start.WAKE_RUNTIME_CONFIG)).encode()) as command:
            start.wake_guard(record)
        read.assert_called_once_with(start.WAKE_CONFIG, owner=(1000, 1000), exact_mode=0o600)
        inspect.assert_called_once_with(start.WAKE_CONTAINER)
        command.assert_called_once_with("docker", "exec", start.WAKE_CONTAINER, "sha256sum", str(start.WAKE_RUNTIME_CONFIG))

    def test_wake_guard_refuses_absent_or_wrong_host_config(self):
        record = pins()
        with mock.patch.object(start, "secure_file", side_effect=FileNotFoundError) as read, \
             mock.patch.object(start, "inspect") as inspect:
            with self.assertRaises(FileNotFoundError):
                start.wake_guard(record)
            read.assert_called_once_with(start.WAKE_CONFIG, owner=(1000, 1000), exact_mode=0o600)
            inspect.assert_not_called()
        with mock.patch.object(start, "secure_file", return_value=b"wrong config"), \
             mock.patch.object(start, "inspect") as inspect:
            with self.assertRaisesRegex(start.Refused, "wake_drift"):
                start.wake_guard(record)
            inspect.assert_not_called()

    def test_wake_guard_refuses_wrong_target_or_count_even_with_matching_hash(self):
        for wake in (b"http://127.0.0.1:3000/api/phone11/wake", start.WAKE_URL * 2):
            with self.subTest(wake=wake):
                record = pins()
                record["wake"]["config_sha256"] = start.digest(wake)
                with mock.patch.object(start, "secure_file", return_value=wake), \
                     mock.patch.object(start, "inspect") as inspect:
                    with self.assertRaisesRegex(start.Refused, "wake_drift"):
                        start.wake_guard(record)
                    inspect.assert_not_called()

    def test_wake_guard_refuses_mount_or_runtime_hash_drift(self):
        record = pins()
        wake = start.WAKE_URL
        record["wake"]["config_sha256"] = start.digest(wake)
        with mock.patch.object(start, "secure_file", return_value=wake), \
             mock.patch.object(start, "inspect", return_value=wake_container([{"Type": "bind", "Source": "/tmp/decoy",
                 "Destination": str(start.WAKE_RUNTIME_CONFIG.parent)}])), \
             mock.patch.object(start, "command") as command:
            with self.assertRaisesRegex(start.Refused, "wake_mount_drift"):
                start.wake_guard(record)
            command.assert_not_called()
        with mock.patch.object(start, "secure_file", return_value=wake), \
             mock.patch.object(start, "inspect", return_value=wake_container()), \
             mock.patch.object(start, "command", return_value=("f" * 64 + "  " + str(start.WAKE_RUNTIME_CONFIG)).encode()):
            with self.assertRaisesRegex(start.Refused, "wake_runtime_drift"):
                start.wake_guard(record)

    def test_wake_guard_refuses_replacement_wrong_image_or_stopped_container(self):
        record = pins()
        wake = start.WAKE_URL
        record["wake"]["config_sha256"] = start.digest(wake)
        for field, value, stage in (("Id", "f" * 64, "wake_container_identity"),
                                    ("Image", "sha256:" + "f" * 64, "wake_container_identity"),
                                    ("State", {"Running": False}, "wake_container_stopped")):
            with self.subTest(field=field):
                container = wake_container()
                container[field] = value
                with mock.patch.object(start, "secure_file", return_value=wake), \
                     mock.patch.object(start, "inspect", return_value=container), \
                     mock.patch.object(start, "command") as command:
                    with self.assertRaisesRegex(start.Refused, stage):
                        start.wake_guard(record)
                    command.assert_not_called()

    def test_wake_file_requires_exact_owner_mode_and_single_regular_link(self):
        for uid, gid, mode, links in ((0, 1000, 0o600, 1), (1000, 0, 0o600, 1),
                                      (1000, 1000, 0o640, 1), (1000, 1000, 0o600, 2),
                                      (1000, 1000, stat.S_IFLNK | 0o600, 1)):
            with self.subTest(uid=uid, gid=gid, mode=mode, links=links):
                info = SimpleNamespace(st_mode=(mode if stat.S_IFMT(mode) else stat.S_IFREG | mode),
                                       st_nlink=links, st_uid=uid, st_gid=gid, st_size=4,
                                       st_dev=1, st_ino=2)
                with mock.patch.object(start.Path, "lstat", return_value=info), \
                     mock.patch.object(start.os, "open") as opened:
                    with self.assertRaisesRegex(start.Refused, "file_shape|file_owner"):
                        start.secure_file(start.WAKE_CONFIG, owner=(1000, 1000), exact_mode=0o600)
                    opened.assert_not_called()

    def test_wake_file_rechecks_owner_after_open_and_root_default_stays_strict(self):
        before = SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_nlink=1, st_uid=1000,
                                 st_gid=1000, st_size=4, st_dev=1, st_ino=2)
        after = SimpleNamespace(**{**vars(before), "st_uid": 0})
        with mock.patch.object(start.Path, "lstat", return_value=before), \
             mock.patch.object(start.os, "open", return_value=7), \
             mock.patch.object(start.os, "fstat", return_value=after), \
             mock.patch.object(start.os, "close") as close:
            with self.assertRaisesRegex(start.Refused, "file_drift"):
                start.secure_file(start.WAKE_CONFIG, owner=(1000, 1000), exact_mode=0o600)
            close.assert_called_once_with(7)
        with mock.patch.object(start.Path, "lstat", return_value=before), \
             mock.patch.object(start.os, "open") as opened:
            with self.assertRaisesRegex(start.Refused, "file_owner"):
                start.secure_file(start.SITE_ENABLED)
            opened.assert_not_called()


class VoicemailReleaseGuards(TestCase):
    def runtime_fixture(self):
        record = pins()
        identities = {}
        for key, name, ident, image in (("backend", start.PREDECESSOR, start.PREDECESSOR_ID, start.PREDECESSOR_IMAGE),
                                      ("freeswitch", start.voicemail.FREESWITCH, "f" * 64, "sha256:" + "f" * 64)):
            item = {"Name": "/" + name, "Id": ident, "Image": image,
                    "State": {"Running": True}, "Config": {"Env": ["PHONE11_VOICEMAIL_HOOK_READY=false"]},
                    "HostConfig": {}, "Mounts": []}
            identities[key] = item
        record["predecessor"]["runtime_sha256"] = start.runtime_hash(identities["backend"])
        evidence = {key: {"name": item["Name"][1:], "container_id": item["Id"], "image": item["Image"],
                          "runtime_sha256": start.runtime_hash(item), "hook_ready": False}
                    for key, item in identities.items()}
        evidence["lua"] = {"modules_config_sha256": "a" * 64}
        return record, evidence, identities

    def guard_context(self, stack, evidence, identities):
        reader = stack.enter_context(mock.patch.object(start.voicemail, "read_prerequisite", return_value=(evidence, "a" * 64)))
        stack.enter_context(mock.patch.object(start, "inspect", side_effect=lambda name: identities["backend" if name == start.PREDECESSOR else "freeswitch"]))
        def hashes(*args):
            path = args[-1]
            expected = start.voicemail.HELPERS.get(Path(path).name, "a" * 64)
            return (expected + "  " + path).encode()
        command = stack.enter_context(mock.patch.object(start, "command", side_effect=hashes))
        return reader, command

    def test_private_evidence_runtime_identities_and_installed_hashes_are_bound(self):
        record, evidence, identities = self.runtime_fixture()
        with ExitStack() as stack:
            reader, command = self.guard_context(stack, evidence, identities)
            self.assertEqual(start.voicemail_guard(record, Path("/root/receipt"), Path("/root/source")), "a" * 64)
            self.assertEqual(command.call_count, 3)
            self.assertEqual(reader.call_args.args[:3], (Path("/root/receipt"), Path("/root/source"), record))
            self.assertTrue(all(call.args[:4] == ("docker", "exec", "f" * 64, "sha256sum")
                                for call in command.call_args_list))

    def test_missing_private_evidence_and_changed_receipt_refuse_before_runtime_commands(self):
        record, evidence, _ = self.runtime_fixture()
        with mock.patch.object(start.voicemail, "read_prerequisite", side_effect=start.voicemail.Refused("prerequisite_file_unavailable")), \
             mock.patch.object(start, "inspect") as inspect:
            with self.assertRaisesRegex(start.Refused, "prerequisite_file_unavailable"):
                start.voicemail_guard(record, Path("/missing"), Path("/source"))
            inspect.assert_not_called()
        with mock.patch.object(start.voicemail, "read_prerequisite", return_value=(evidence, "b" * 64)), \
             mock.patch.object(start, "inspect") as inspect:
            with self.assertRaisesRegex(start.Refused, "prerequisite_receipt_changed"):
                start.voicemail_guard(record, Path("/receipt"), Path("/source"), "a" * 64)
            inspect.assert_not_called()

    def test_wrong_backend_or_freeswitch_id_image_runtime_or_flag_refuse(self):
        for key in ("backend", "freeswitch"):
            for field, value in (("Id", "0" * 64), ("Image", "sha256:" + "0" * 64), ("Name", "/decoy"),
                                 ("State", {"Running": False}),
                                 ("Config", {"Env": ["PHONE11_VOICEMAIL_HOOK_READY=true"]})):
                record, evidence, identities = self.runtime_fixture()
                identities[key][field] = value
                with self.subTest(key=key, field=field), ExitStack() as stack:
                    _, command = self.guard_context(stack, evidence, identities)
                    with self.assertRaises(start.Refused):
                        start.voicemail_guard(record, Path("/receipt"), Path("/source"))
                    command.assert_not_called()
        # Even a receipt pinning protected mode must fail the observed flag guard.
        record, evidence, identities = self.runtime_fixture()
        identities["freeswitch"]["Config"]["Env"] = ["PHONE11_VOICEMAIL_HOOK_READY=true"]
        evidence["freeswitch"]["runtime_sha256"] = start.runtime_hash(identities["freeswitch"])
        with ExitStack() as stack:
            self.guard_context(stack, evidence, identities)
            with self.assertRaisesRegex(start.Refused, "runtime_flag_not_off"):
                start.voicemail_guard(record, Path("/receipt"), Path("/source"))

    def test_live_helper_or_module_config_drift_refuses(self):
        for filename in (*start.voicemail.HELPERS, "modules.conf.xml"):
            record, evidence, identities = self.runtime_fixture()
            with self.subTest(filename=filename), ExitStack() as stack:
                _, command = self.guard_context(stack, evidence, identities)
                original = command.side_effect
                command.side_effect = lambda *args: ("b" * 64 + "  " + args[-1]).encode() if Path(args[-1]).name == filename else original(*args)
                with self.assertRaises(start.Refused):
                    start.voicemail_guard(record, Path("/receipt"), Path("/source"))

    def start_context(self, stack, guard_results):
        source = {"Config": {"Env": ["PHONE11_RUNTIME_ROLE=api-candidate", "PORT=3016"]},
                  "HostConfig": {"NetworkMode": "test", "Memory": 1024}, "Mounts": []}
        stack.enter_context(mock.patch.object(start.os, "geteuid", return_value=0))
        for name in ("site_and_wake", "pinned_container", "candidate_image", "absent_target", "health", "check_candidate"):
            stack.enter_context(mock.patch.object(start, name))
        stack.enter_context(mock.patch.object(start, "source_runtime", return_value=source))
        stack.enter_context(mock.patch.object(start, "inspect", return_value={"Id": "f" * 64,
                            "State": {"Health": {"Status": "healthy"}}, "HostConfig": {"RestartPolicy": {"Name": "unless-stopped"}}}))
        guard = stack.enter_context(mock.patch.object(start, "voicemail_guard", side_effect=guard_results))
        create = stack.enter_context(mock.patch.object(start, "create_in_memory", return_value="f" * 64))
        command = stack.enter_context(mock.patch.object(start, "command", return_value=b""))
        receipt = stack.enter_context(mock.patch.object(start, "write_receipt", return_value=Path("/receipt")))
        return guard, create, command, receipt

    def test_mandatory_missing_barrier_refuses_before_any_docker_command(self):
        with mock.patch.object(start.os, "geteuid", return_value=0), mock.patch.object(start, "command") as command, \
             mock.patch.object(start, "create_in_memory") as create:
            with self.assertRaisesRegex(start.Refused, "voicemail_prerequisite_required"):
                start.start(pins())
            command.assert_not_called()
            create.assert_not_called()

    def test_old_cli_without_prerequisite_refuses_before_lock_or_commands(self):
        with mock.patch.object(start.sys, "argv", ["release-start", "--manifest", "/root/manifest"]), \
             mock.patch.object(start.sys, "stderr"), mock.patch.object(start, "lock") as lock, \
             mock.patch.object(start, "command") as command:
            with self.assertRaises(SystemExit) as caught:
                start.main()
            self.assertEqual(caught.exception.code, 2)
            lock.assert_not_called()
            command.assert_not_called()

    def test_failed_first_gate_refuses_before_candidate_creation(self):
        for code in ("prerequisite_stale_or_future", "prerequisite_flag_not_off", "prerequisite_helper_mismatch",
                     "prerequisite_file_unavailable", "prerequisite_backend_mismatch", "prerequisite_lua_unknown_or_missing"):
            with self.subTest(code=code), ExitStack() as stack:
                _, create, command, receipt = self.start_context(stack, [start.Refused(code)])
                with self.assertRaisesRegex(start.Refused, code):
                    start.start(pins(), Path("/receipt"), Path("/source"))
                create.assert_not_called()
                command.assert_not_called()
                receipt.assert_not_called()

    def test_success_rechecks_unchanged_evidence_before_receipt(self):
        with ExitStack() as stack:
            guard, create, _, receipt = self.start_context(stack, ["a" * 64, "a" * 64])
            sequence = []
            guard.side_effect = lambda *a: sequence.append("guard") or "a" * 64
            create.side_effect = lambda *a: sequence.append("create") or "f" * 64
            receipt.side_effect = lambda *a: sequence.append("receipt") or Path("/receipt")
            self.assertEqual(start.start(pins(), Path("/receipt"), Path("/source")), Path("/receipt"))
            self.assertEqual(sequence, ["guard", "create", "guard", "receipt"])
            self.assertEqual(guard.call_args.args[3], "a" * 64)

    def test_failed_final_gate_produces_no_receipt_and_cleans_only_owned_candidate(self):
        with ExitStack() as stack:
            guard, create, command, receipt = self.start_context(stack, ["a" * 64, start.Refused("prerequisite_receipt_changed")])
            with self.assertRaisesRegex(start.Refused, "prerequisite_receipt_changed"):
                start.start(pins(), Path("/receipt"), Path("/source"))
            self.assertEqual(guard.call_count, 2)
            create.assert_called_once()
            receipt.assert_not_called()
            command.assert_any_call("docker", "rm", "-f", "f" * 64)


class RouteGuards(TestCase):
    def test_protected_route_uses_shared_wake_guard(self):
        record = pins()
        with mock.patch.object(route.start, "source_runtime", return_value={}), \
             mock.patch.object(route.start, "pinned_container"), \
             mock.patch.object(route.start, "wake_guard", side_effect=start.Refused("wake_drift")) as wake:
            with self.assertRaisesRegex(start.Refused, "wake_drift"):
                route.protected(record)
            wake.assert_called_once_with(record)

    def setup_route(self):
        record = pins()
        before = b"before"
        after = b"after"
        receipt = {"candidate_id": "f" * 64, "fixture_sha256": "a" * 64,
                   "active_dump_sha256": start.digest(b"active-dump"), "state": "prepared"}
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
                route.rollback(record, Path("/unused"), "https://api.phone11.ai")
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
        values = [{"label": label, "method": "GET", "body": "", "path": path,
                   "headers": {"Cookie": "session=fixture"},
                   "status": 403 if label == "denied_tenant" else 200}
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

    def test_probes_mark_each_get_without_changing_sealed_fixture(self):
        raw = b"fixture"
        values = [{"label": label, "method": "GET", "body": "", "path": path,
                   "headers": {"Cookie": "session=fixture"},
                   "status": 403 if label == "denied_tenant" else 200}
                  for label, path in (("existing_phone", "/api/trpc/phone.getConfig"),
                                      ("existing_chat", "/api/trpc/chat.list"),
                                      ("conference", "/api/trpc/conference.list"),
                                      ("mixed_batch", "/api/trpc/phone.getConfig,chat.list?batch=1"),
                                      ("denied_tenant", "/api/trpc/phone.getConfig"))]
        with mock.patch.object(route, "root_file", return_value=raw), \
             mock.patch.object(route.pilot, "load_probes", return_value=values), \
             mock.patch.object(route.pilot, "run_probes") as http:
            route.probes(Path("/fixture"), route.start.digest(raw), "https://api.phone11.ai")
            sent = http.call_args.args[2]
            self.assertEqual(len(sent), 5)
            self.assertTrue(all(probe["headers"][route.READ_ONLY_PROBE_HEADER] == "1" for probe in sent))
            self.assertTrue(all(route.READ_ONLY_PROBE_HEADER not in probe["headers"] for probe in values))

        values[0]["headers"]["x-phone11-read-only-probe"] = "0"
        with mock.patch.object(route, "root_file", return_value=raw), \
             mock.patch.object(route.pilot, "load_probes", return_value=values), \
             mock.patch.object(route.pilot, "run_probes") as http:
            with self.assertRaisesRegex(route.start.Refused, "probe_read_only"):
                route.probes(Path("/fixture"), route.start.digest(raw), "https://api.phone11.ai")
            http.assert_not_called()

    def test_rollback_candidate_down_restores_pinned_predecessor_without_authenticated_probe(self):
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
             mock.patch.object(route, "probes") as probes, \
             mock.patch.object(route.old, "atomic_write") as receipt_write, \
             mock.patch.object(route.start, "command", side_effect=(b"active-dump", b"headbeforetail")):
            route.rollback(record, Path("/unused"), "https://api.phone11.ai")
        self.assertEqual(current[0], before)
        self.assertEqual(calls, [None, None])
        probes.assert_not_called()
        receipt_write.assert_called_once()

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
                route.rollback(record, Path("/unused"), "https://api.phone11.ai")
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
             mock.patch.object(route, "probes") as probes, \
             mock.patch.object(route.old, "atomic_write") as receipt_write, \
             mock.patch.object(route.start, "command", side_effect=(b"headaftertail", b"headbeforetail")):
            route.recover(record, route.ROOT / "receipt", "https://api.phone11.ai")
        self.assertEqual(current[0], before)
        self.assertEqual(receipt["state"], "aborted")
        self.assertEqual(protected.call_count, 2)
        probes.assert_not_called()
        receipt_write.assert_called_once()

    def test_recover_interrupted_rollback_reconciles_receipt(self):
        record, before, after, receipt = self.setup_route()
        receipt["state"] = "active"
        record["nginx"]["dump_sha256"] = route.start.digest(b"headbeforetail")
        with mock.patch.object(route, "root_file", return_value=b'{"state":"active"}'), \
             mock.patch.object(route, "sealed", return_value=(receipt, before, after)), \
             mock.patch.object(route, "site", return_value=(before, mock.Mock())), \
             mock.patch.object(route, "protected"), mock.patch.object(route, "probes") as probes, \
             mock.patch.object(route, "write_site") as write, \
             mock.patch.object(route, "reload") as reload, \
             mock.patch.object(route.old, "atomic_write") as receipt_write, \
             mock.patch.object(route.start, "command", return_value=b"headbeforetail"):
            route.recover(record, route.ROOT / "receipt", "https://api.phone11.ai")
        self.assertEqual(receipt["state"], "rolled_back")
        write.assert_not_called()
        reload.assert_called_once()
        probes.assert_not_called()
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
            directory = route.prepare(record, Path("/start.json"), Path("/candidate-probes"), "a" * 64)
            route.activate(record, directory, Path("/candidate-probes"), "https://api.phone11.ai")
            self.assertEqual(current[0], after)
            route.rollback(record, directory, "https://api.phone11.ai")
            self.assertEqual(current[0], before)
            self.assertEqual(json.loads(files[str(directory / "receipt.json")])["state"], "rolled_back")
            self.assertEqual(probes.call_count, 3)
            self.assertEqual([call.args[2] for call in probes.call_args_list],
                             [f"http://127.0.0.1:{record['candidate']['port']}"] * 2
                             + ["https://api.phone11.ai"])


if __name__ == "__main__":
    main()
