#!/usr/bin/env python3
"""Offline supervisor tests. No Docker, API, message, database or phone access."""
import copy
import contextlib
import io
import importlib.util
import json
import os
import stat
import tempfile
import types
from pathlib import Path
import subprocess
from unittest import TestCase, main, mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("relay_runtime", ROOT / "scripts/phone11-voicemail-relay-runtime.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


def packet():
    return {"schema": gate.SCHEMA, "sourceRevision": "a" * 40, "bundleManifestSha256": "b" * 64,
            "backend": {"name": "cp11-api-current-reviewed", "id": "c" * 64, "image": "sha256:" + "d" * 64,
                        "started": "2026-10-23T00:00:00.123456789Z"},
            "backendBundleSha256": "e" * 64,
            "freeswitch": {"name": "p11-freeswitch", "id": "f" * 64, "image": "sha256:" + "1" * 64,
                           "started": "2026-10-23T00:00:00.123456789Z"},
            "artifacts": {name: "2" * 64 for name in gate.ARTIFACT_PATHS},
            "uploadUrl": "https://api.example.test/api/recordings/voicemail", "runtimeUid": 0,
            "runtimeGid": 0, "hookReady": True}


def probe(p):
    calls = []
    def invoke(*args):
        calls.append(args)
        if args[1] == "inspect":
            pin = next(p[k] for k in ("backend", "freeswitch") if p[k]["id"] == args[-1])
            return " ".join(json.dumps(x) for x in (pin["id"], "/" + pin["name"], pin["image"], pin["started"], True, False))
        if args[3] == "sha256sum":
            paths = dict(gate.ARTIFACT_PATHS, **gate.TRUSTED_ARTIFACT_PATHS)
            name = next((name for name, target in paths.items() if target == args[-1]), None)
            digest = p["backendBundleSha256"] if args[2] == p["backend"]["id"] else p["artifacts"][name]
            return digest + "  " + args[-1]
        if args[-1] == gate.TRUSTED_FS_PROBE:
            return json.dumps(dict(native_config(), handoffDirectory={"directory": True, "symlink": False,
                                                                     "uid": 0, "gid": 0, "mode": 0o700}))
        if args[-1] == gate.BACKEND_PROBE:
            return json.dumps({"hookReady": p["hookReady"]})
        if args[-1] == gate.FS_PROBE:
            return json.dumps({"nodeMajor": 22, "uid": 0, "gid": 0,
                "dirs": [{"directory": True, "symlink": False, "uid": 0, "gid": 0, "mode": 0o700}] * 2,
                "sourceRoot": gate.SOURCE_ROOT, "outboxRoot": gate.OUTBOX_ROOT, "uploadUrl": p["uploadUrl"],
                "hookReady": p["hookReady"], "secretConfigured": True, "mailboxMapConfigured": True})
        raise AssertionError("Unreviewed command")
    return invoke, calls


class RuntimeChecks(TestCase):
    def test_current_backend_name_is_supplied_not_historically_hardcoded(self):
        p = packet()
        invoke, calls = probe(p)
        gate.check(p, invoke)
        self.assertEqual(sum(x[1] == "inspect" for x in calls), 4)
        self.assertFalse(any("--once" in x for x in calls))
        self.assertFalse(any("Env" in " ".join(x) for x in calls))

    def test_flag_off_metadata_check_does_not_process_queue(self):
        p = packet()
        p["hookReady"] = False
        invoke, _ = probe(p)
        gate.check(p, invoke)
        execute = mock.Mock()
        with self.assertRaisesRegex(gate.Refused, "activation_packet"):
            gate.run(p, execute)
        execute.assert_not_called()

    def test_container_identity_epoch_running_state_and_final_window_drift_refuse(self):
        for position, replacement in ((0, "0" * 64), (1, "/decoy"), (2, "sha256:" + "0" * 64),
                                      (3, "2026-10-23T01:00:00.123456789Z"), (4, False), (5, True)):
            for final in (False, True):
                p = packet()
                delegate, _ = probe(p)
                count = 0
                def invoke(*args):
                    nonlocal count
                    raw = delegate(*args)
                    if args[1] == "inspect":
                        count += 1
                        if count == (3 if final else 1):
                            values = [json.loads(x) for x in raw.split()]
                            values[position] = replacement
                            return " ".join(json.dumps(x) for x in values)
                    return raw
                with self.subTest(position=position, final=final), self.assertRaisesRegex(gate.Refused, "container_drift"):
                    gate.check(p, invoke)

    def test_installed_helper_and_backend_bytes_are_exact_pinned(self):
        for target in [*gate.ARTIFACT_PATHS.values(), "/app/dist/index.mjs"]:
            p = packet()
            delegate, _ = probe(p)
            def invoke(*args):
                return "0" * 64 + "  " + target if args[-1] == target else delegate(*args)
            with self.subTest(target=target), self.assertRaises(gate.Refused):
                gate.check(p, invoke)

    def test_unsafe_native_runtime_or_flag_mismatch_refuse(self):
        changes = [("nodeMajor", 20), ("uid", 1000), ("gid", 1000), ("hookReady", False),
                   ("sourceRoot", "/tmp/source"), ("outboxRoot", "/tmp/outbox"),
                   ("secretConfigured", False), ("mailboxMapConfigured", False),
                   ("uploadUrl", "https://other.example/api/recordings/voicemail"), ("dirs", [])]
        for key, value in changes:
            p = packet()
            delegate, _ = probe(p)
            def invoke(*args):
                raw = delegate(*args)
                if args[-1] == gate.FS_PROBE:
                    data = json.loads(raw)
                    data[key] = value
                    return json.dumps(data)
                return raw
            with self.subTest(key=key), self.assertRaisesRegex(gate.Refused, "native_configuration"):
                gate.check(p, invoke)

    def test_run_uses_immutable_id_fixed_lock_and_only_aggregate_result(self):
        p = packet()
        execute = mock.Mock(return_value=subprocess.CompletedProcess([], 0,
            stdout=b"voicemail relay: delivered=2 quarantined=1 retry=3\n"))
        self.assertEqual(gate.run(p, execute), {"delivered": 2, "quarantined": 1, "retry": 3})
        args, kwargs = execute.call_args
        self.assertEqual(args[0], ["/usr/bin/docker", "exec", p["freeswitch"]["id"], "/usr/bin/flock", "-n",
            gate.OUTBOX_ROOT + "/.relay.lock", "/usr/local/bin/node", gate.ARTIFACT_PATHS["relay.mjs"], "--once"])
        self.assertEqual(kwargs["stderr"], subprocess.DEVNULL)

    def test_failed_pass_or_unexpected_result_refuses(self):
        for status, raw in ((1, b""), (0, b"private unexpected text")):
            execute = mock.Mock(return_value=subprocess.CompletedProcess([], status, stdout=raw))
            with self.subTest(status=status), self.assertRaises(gate.Refused):
                gate.run(packet(), execute)

    def test_packet_extra_missing_unsafe_or_duplicate_values_refuse(self):
        for mutate in (lambda p: p.update(extra=True), lambda p: p.pop("artifacts"),
                       lambda p: p.update(hookReady="true"), lambda p: p.update(runtimeUid=False),
                       lambda p: p["backend"].update(name="invalid/name"),
                       lambda p: p.update(uploadUrl="https://user:secret@example.test/api/recordings/voicemail")):
            p = packet()
            mutate(p)
            with self.assertRaises(gate.Refused):
                gate.validate(p)
        with self.assertRaises(gate.Refused):
            gate.unique([("key", 1), ("key", 2)])


def native_config():
    return {"kamailioIp": "172.18.0.3", "apiBase": "http://127.0.0.1:3013/api/voicemail/local-fallback",
            "handoffRoot": "/var/lib/phone11-voicemail/fallback-handoff"}


def trusted_packet():
    p = packet()
    p.update(schema=gate.TRUSTED_SCHEMA, sourceRevision=gate.TRUSTED_NATIVE_SOURCE_BASE, lane=gate.TRUSTED_LANE,
             artifacts=copy.deepcopy(gate.TRUSTED_ARTIFACTS), bundleManifestSha256=gate.TRUSTED_BUNDLE_MANIFEST,
             backendBundleSha256=gate.TRUSTED_BACKEND_BUNDLE, hookReady=False,
             protocolEvidence={"backendDerivative": {"path": "/operator/private/derivative.json",
                                                     "sha256": gate.TRUSTED_DERIVATIVE_MANIFEST},
                               "trustedIngress": {"path": "/operator/private/ingress.json", "sha256": "3" * 64}})
    return p


def evidence_documents(p):
    return {"backendDerivative": {"schema": "phone11-voicemail-epoch-backend-derivative/v2",
                "patchCommit": gate.TRUSTED_PATCH_COMMIT, "patchStorageSha256": gate.TRUSTED_SOURCE_INPUTS["backendStorage"],
                "schemaFixCommit": gate.TRUSTED_SCHEMA_FIX_COMMIT,
                "reviewedSources": copy.deepcopy(gate.TRUSTED_BACKEND_SOURCES),
                "patchedBundleSha256": gate.TRUSTED_BACKEND_BUNDLE,
                "sourceChanges": sorted(gate.TRUSTED_BACKEND_SOURCES), "externalRuntimeDependenciesUnchanged": True},
            "trustedIngress": {"schema": "phone11-trusted-local-fallback-commissioning/v1",
                "status": "loaded-one-use-owner-epoch-ingress-bound", "lane": gate.TRUSTED_LANE,
                "freeswitch": copy.deepcopy(p["freeswitch"]), "backend": copy.deepcopy(p["backend"]),
                "backendBundleSha256": p["backendBundleSha256"], "sourceInputs": copy.deepcopy(gate.TRUSTED_SOURCE_INPUTS),
                "nativeGlobalHookReady": False, "backendGlobalHookReady": False,
                "backendDerivativeSha256": gate.TRUSTED_DERIVATIVE_MANIFEST, "backendRuntimeProofSha256": "4" * 64,
                "uploadUrl": p["uploadUrl"], "uploadRouteProofSha256": "8" * 64,
                "ownerEpochAdmissionPath": gate.TRUSTED_ADMISSION_PATH,
                "nativeConfig": native_config(), "loadedDialplan": {"context": "phone11-local-voicemail",
                    "publicEntrySha256": "5" * 64, "contextSha256": "6" * 64, "proofSha256": "7" * 64,
                    "oneUseReferenceRequired": True, "authenticatedKamailioSourceBound": True,
                    "canonicalOwnerEpochHandoff": True}}}


def evidence_reader(p, docs=None):
    docs = docs if docs is not None else evidence_documents(p)
    def read(path):
        name, ref = next((name, ref) for name, ref in p["protocolEvidence"].items() if ref["path"] == path)
        return copy.deepcopy(docs[name]), ref["sha256"]
    return read


class TrustedFallbackChecks(TestCase):
    def test_explicit_lane_selection_does_not_change_v1_default(self):
        gate.selection(packet(), False)
        gate.selection(trusted_packet(), True)
        for p, explicit in ((packet(), True), (trusted_packet(), False)):
            with self.assertRaisesRegex(gate.Refused, "trusted_lane_selection"):
                gate.selection(p, explicit)

    def test_trusted_check_requires_seven_pinned_artifacts_and_process_windows(self):
        p = trusted_packet()
        invoke, calls = probe(p)
        admission = gate.check(p, invoke, evidence_reader(p))
        self.assertIsInstance(admission, gate.TrustedAdmission)
        self.assertEqual(sum(args[1] == "inspect" for args in calls), 4)
        self.assertEqual(sum(args[3] == "sha256sum" for args in calls if len(args) > 3), 8)
        self.assertFalse(any("--once" in args or "readdir" in " ".join(args) for args in calls))

    def test_packet_cannot_select_a_different_protocol_or_old_release(self):
        changes = [("hookReady", True), ("lane", "bypass"), ("schema", gate.SCHEMA),
                   ("sourceRevision", "a" * 40), ("bundleManifestSha256", "0" * 64),
                   ("backendBundleSha256", "0" * 64)]
        for key, value in changes:
            p = trusted_packet()
            p[key] = value
            with self.subTest(key=key), self.assertRaises(gate.Refused):
                gate.validate(p)
        for name in gate.TRUSTED_ARTIFACTS:
            p = trusted_packet()
            p["artifacts"][name] = "0" * 64
            with self.subTest(artifact=name), self.assertRaisesRegex(gate.Refused, "trusted_native_release"):
                gate.validate(p)
        p = trusted_packet()
        p["backend"]["image"] = gate.BASE_BACKEND_IMAGE
        with self.assertRaisesRegex(gate.Refused, "trusted_backend_release"):
            gate.validate(p)

    def test_combined_derivative_requires_exact_three_reviewed_sources(self):
        expected = ["server/invitations/service.ts", "server/pbx/database-readiness.ts", "server/pbx/recording-storage.ts"]
        self.assertEqual(sorted(gate.TRUSTED_BACKEND_SOURCES), expected)
        mutations = [("schema", "phone11-voicemail-epoch-backend-derivative/v1"),
                     ("schemaFixCommit", "0" * 40),
                     ("sourceChanges", expected[1:]),
                     ("sourceChanges", expected + ["server/other.ts"]),
                     ("sourceChanges", list(reversed(expected))),
                     ("patchedBundleSha256", "a9bca89199729c584af557742140c72b7a7718b7eb4c22834c3b6c7de5a08cbe")]
        for key, value in mutations:
            p = trusted_packet()
            docs = evidence_documents(p)
            docs["backendDerivative"][key] = value
            invoke = mock.Mock()
            with self.subTest(key=key, value=value), self.assertRaisesRegex(gate.Refused, "trusted_backend_source"):
                gate.check(p, invoke, evidence_reader(p, docs))
            invoke.assert_not_called()
        for source in expected:
            for key in ("commit", "baseSha256", "sha256", "bytes"):
                p = trusted_packet()
                docs = evidence_documents(p)
                docs["backendDerivative"]["reviewedSources"][source][key] = 0 if key == "bytes" else "0" * 64
                invoke = mock.Mock()
                with self.subTest(source=source, key=key), self.assertRaisesRegex(gate.Refused, "trusted_backend_source"):
                    gate.check(p, invoke, evidence_reader(p, docs))
                invoke.assert_not_called()
        p = trusted_packet()
        p["backendBundleSha256"] = "a9bca89199729c584af557742140c72b7a7718b7eb4c22834c3b6c7de5a08cbe"
        with self.assertRaisesRegex(gate.Refused, "trusted_backend_release"):
            gate.validate(p)
        p = trusted_packet()
        p["protocolEvidence"]["backendDerivative"]["sha256"] = "73748c761883948a997d3e803b9ce70b4ca9395d6b2d981fc65fc84feb3087c6"
        with self.assertRaisesRegex(gate.Refused, "trusted_derivative_source"):
            gate.validate(p)

    def test_missing_wrong_or_stale_evidence_refuses_before_docker(self):
        mutations = [("backendDerivative", "patchStorageSha256", "0" * 64),
                     ("backendDerivative", "sourceChanges", []),
                     ("trustedIngress", "backend", packet()["freeswitch"]),
                     ("trustedIngress", "nativeGlobalHookReady", True),
                     ("trustedIngress", "backendGlobalHookReady", True),
                     ("trustedIngress", "backendDerivativeSha256", "0" * 64),
                     ("trustedIngress", "backendRuntimeProofSha256", "not-a-hash"),
                     ("trustedIngress", "sourceInputs", {}),
                     ("trustedIngress", "ownerEpochAdmissionPath", "/admission/legacy"),
                     ("trustedIngress", "uploadUrl", "https://wrong.example/api/recordings/voicemail"),
                     ("trustedIngress", "uploadRouteProofSha256", ""),
                     ("trustedIngress", "status", "source-only")]
        for document, key, value in mutations:
            p = trusted_packet()
            docs = evidence_documents(p)
            docs[document][key] = value
            invoke = mock.Mock()
            with self.subTest(document=document, key=key), self.assertRaises(gate.Refused):
                gate.check(p, invoke, evidence_reader(p, docs))
            invoke.assert_not_called()
        p = trusted_packet()
        with self.assertRaises(OSError):
            gate.check(p, mock.Mock(), mock.Mock(side_effect=OSError("private path must not escape")))
        with self.assertRaisesRegex(gate.Refused, "trusted_evidence_drift"):
            gate.check(p, mock.Mock(), lambda path: ({}, "0" * 64))

    def test_loaded_ingress_and_canonical_redemption_are_required(self):
        for key, value in [("context", "default"), ("publicEntrySha256", ""), ("proofSha256", ""),
                           ("oneUseReferenceRequired", False), ("authenticatedKamailioSourceBound", False),
                           ("canonicalOwnerEpochHandoff", False)]:
            p = trusted_packet()
            docs = evidence_documents(p)
            docs["trustedIngress"]["loadedDialplan"][key] = value
            with self.subTest(key=key), self.assertRaises(gate.Refused):
                gate.check(p, mock.Mock(), evidence_reader(p, docs))
        for key, value in [("kamailioIp", "not-an-ip"), ("apiBase", "http://untrusted/api/voicemail/local-fallback"),
                           ("handoffRoot", "/private/../outbox")]:
            p = trusted_packet()
            docs = evidence_documents(p)
            docs["trustedIngress"]["nativeConfig"][key] = value
            with self.subTest(key=key), self.assertRaises((gate.Refused, ValueError)):
                gate.check(p, mock.Mock(), evidence_reader(p, docs))

    def test_live_fallback_configuration_and_handoff_custody_must_match_evidence(self):
        changes = [("kamailioIp", "172.18.0.4"), ("apiBase", "http://127.0.0.1:3012/api/voicemail/local-fallback"),
                   ("handoffRoot", "/different"), ("handoffDirectory", {}),
                   ("handoffDirectory", {"directory": True, "symlink": True, "uid": 0, "gid": 0, "mode": 0o700})]
        for key, value in changes:
            p = trusted_packet()
            delegate, _ = probe(p)
            def invoke(*args):
                raw = delegate(*args)
                if args[-1] == gate.TRUSTED_FS_PROBE:
                    data = json.loads(raw)
                    data[key] = value
                    return json.dumps(data)
                return raw
            with self.subTest(key=key), self.assertRaisesRegex(gate.Refused, "trusted_native_configuration"):
                gate.check(p, invoke, evidence_reader(p))

    def test_global_flags_true_refuse_for_trusted_lane(self):
        for target in (gate.FS_PROBE, gate.BACKEND_PROBE):
            p = trusted_packet()
            delegate, _ = probe(p)
            def invoke(*args):
                raw = delegate(*args)
                if args[-1] == target:
                    data = json.loads(raw)
                    data["hookReady"] = True
                    return json.dumps(data)
                return raw
            with self.subTest(target=target), self.assertRaises(gate.Refused):
                gate.check(p, invoke, evidence_reader(p))

    def test_run_requires_checked_evidence_and_preserves_fixed_lock_and_counts(self):
        p = trusted_packet()
        execute = mock.Mock(return_value=subprocess.CompletedProcess([], 0,
            stdout=b"voicemail relay: delivered=0 quarantined=0 retry=0\n"))
        with self.assertRaisesRegex(gate.Refused, "trusted_checks_required"):
            gate.run(p, execute, read_evidence=evidence_reader(p))
        execute.assert_not_called()
        invoke, _ = probe(p)
        admission = gate.check(p, invoke, evidence_reader(p))
        self.assertEqual(gate.run(p, execute, admission, evidence_reader(p)), {"delivered": 0, "quarantined": 0, "retry": 0})
        self.assertIn(gate.OUTBOX_ROOT + "/.relay.lock", execute.call_args.args[0])
        self.assertFalse(p["hookReady"])
        p["uploadUrl"] = "https://different.example/api/recordings/voicemail"
        execute.reset_mock()
        with self.assertRaisesRegex(gate.Refused, "trusted_checks_required"):
            gate.run(p, execute, admission, evidence_reader(p))
        execute.assert_not_called()

    def test_evidence_change_after_check_refuses_before_processing(self):
        p = trusted_packet()
        invoke, _ = probe(p)
        admission = gate.check(p, invoke, evidence_reader(p))
        execute = mock.Mock()
        with self.assertRaisesRegex(gate.Refused, "trusted_evidence_drift"):
            gate.run(p, execute, admission, lambda path: ({}, "0" * 64))
        execute.assert_not_called()

    def test_cli_metadata_check_never_calls_relay_for_trusted_lane(self):
        p = trusted_packet()
        invoke, _ = probe(p)
        admission = gate.check(p, invoke, evidence_reader(p))
        args = ["relay-runtime", "--config", "/private/operator/runtime.json", "--config-sha256", "8" * 64,
                "--trusted-local-fallback-owner-epoch", "--check"]
        with mock.patch("sys.argv", args), mock.patch.object(gate.os, "geteuid", return_value=0), \
             mock.patch.object(gate, "read_packet", return_value=(p, "8" * 64)), \
             mock.patch.object(gate, "check", return_value=admission), mock.patch.object(gate, "run") as run, \
             contextlib.redirect_stdout(io.StringIO()) as stdout:
            self.assertEqual(gate.main(), 0)
        run.assert_not_called()
        result = json.loads(stdout.getvalue())
        self.assertFalse(result["messageAudioRead"])
        self.assertFalse(result["deliveryAccepted"])
        self.assertEqual(result["schema"], gate.TRUSTED_SCHEMA)


    def test_default_and_trusted_units_select_distinct_explicit_packets(self):
        default = (ROOT / "deploy/systemd/phone11-voicemail-relay.service.in").read_text()
        trusted = (ROOT / "deploy/systemd/phone11-voicemail-trusted-fallback-relay.service.in").read_text()
        timer = (ROOT / "deploy/systemd/phone11-voicemail-trusted-fallback-relay.timer").read_text()
        self.assertNotIn("--trusted-local-fallback-owner-epoch", default)
        self.assertIn("runtime.json --config-sha256 CONFIG_SHA256 --run", default)
        self.assertIn("trusted-fallback-runtime.json --config-sha256 CONFIG_SHA256 --trusted-local-fallback-owner-epoch --run", trusted)
        self.assertIn("Unit=phone11-voicemail-trusted-fallback-relay.service", timer)
        self.assertIn("TimeoutStopSec=infinity", trusted)
        self.assertNotIn("PHONE11_VOICEMAIL_HOOK_READY=true", trusted)


    def test_evidence_reader_refuses_links_permissions_and_duplicate_keys(self):
        # Simulate protected root ancestry on this non-root developer account;
        # leaf mode/link checks and O_NOFOLLOW are exercised on actual temp files.
        original_fstat = os.fstat
        def protected_stat(fd):
            observed = original_fstat(fd)
            values = {key: getattr(observed, key) for key in dir(observed) if key.startswith("st_")}
            values["st_uid"] = 0
            if stat.S_ISDIR(observed.st_mode):
                values["st_mode"] &= ~0o022
            return types.SimpleNamespace(**values)
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory).resolve()
            target = Path(directory) / "proof.json"
            target.write_text('{"proof":"source-only"}')
            target.chmod(0o600)
            with mock.patch.object(gate.os, "fstat", side_effect=protected_stat):
                self.assertEqual(gate.read_document(target)[0], {"proof": "source-only"})
                link = Path(directory) / "link.json"
                link.symlink_to(target)
                with self.assertRaises(OSError):
                    gate.read_document(link)
                os.link(target, Path(directory) / "hardlink.json")
                with self.assertRaisesRegex(gate.Refused, "packet_file"):
                    gate.read_document(target)
                (Path(directory) / "hardlink.json").unlink()
                target.chmod(0o644)
                with self.assertRaisesRegex(gate.Refused, "packet_file"):
                    gate.read_document(target)
                target.chmod(0o600)
                target.write_text('{"proof":1,"proof":2}')
                with self.assertRaisesRegex(gate.Refused, "duplicate_key"):
                    gate.read_document(target)


if __name__ == "__main__":
    main()
