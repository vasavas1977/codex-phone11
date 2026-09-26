"""Raw isolated-callback evidence and hook-off handoff gates."""

import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
import wave


ROOT = Path(__file__).resolve().parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


proof = module("phone11_callback_proof_test", ROOT / "scripts/phone11-voicemail-callback-proof.py")
handoff = module("phone11_handoff_callback_test", ROOT / "scripts/phone11-voicemail-handoff-check.py")
harness = module("phone11_callback_harness_test", ROOT / "tests/phone11-voicemail-callback-clone.py")
SHA = lambda data: hashlib.sha256(data).hexdigest()
IMAGE = handoff.clone.ACTIVE_FREESWITCH_IMAGE
SOURCE = "a" * 40
NOW = int(time.time())


def write_private(path, data):
    path.write_bytes(data)
    os.chmod(path, 0o600)


def wav_bytes():
    output = io.BytesIO()
    with wave.open(output, "wb") as recording:
        recording.setnchannels(1)
        recording.setsampwidth(2)
        recording.setframerate(8000)
        recording.writeframes(b"\0\0" * 16000)
    return output.getvalue()


class CallbackProofTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="phone11-callback-proof-")
        self.review_temp = tempfile.TemporaryDirectory(prefix="phone11-callback-review-")
        self.root = Path(self.temp.name)
        self.inspect = {"Id": "b" * 64, "Image": IMAGE, "Mounts": [],
                        "HostConfig": {"NetworkMode": "none", "Binds": [], "Mounts": [],
                                       "PortBindings": {}, "PublishAllPorts": False,
                                       "Privileged": False, "Tmpfs": {"/probe": "rw,size=64m"}},
                        "Config": {"Env": ["PATH=/usr/bin", "LANG=C"]}}
        self.receipt = {"schema": proof.SCHEMA, "source_sha": SOURCE,
                        "lua_sha256": proof.LUA_SHA256,
                        "probe_runner_sha256": proof.PROBE_RUNNER_SHA256,
                        "freeswitch_image": IMAGE,
                        "freeswitch_version": proof.FS_VERSION,
                        "validated_at_unix": NOW,
                        "clone_inspect_sha256": "",
                        "fs_version_sha256": "",
                        "clone_console_sha256": "", "loaded_dialplan_sha256": "",
                        "harness_transcript_sha256": "", "clone_harness_sha256": "",
                        "cases": {}}
        write_private(self.root / "fs-version.txt", (proof.FS_VERSION + "\n").encode())
        write_private(self.root / "probe-runner.sh",
                      (ROOT / "tests/phone11-voicemail-probe-runner.sh").read_bytes())
        wav = wav_bytes()
        console = bytearray()
        transcript = ["clone=fixture image=fixture network=none mounts=none"]
        for index, name in enumerate(proof.CASES):
            directory = self.root / name
            directory.mkdir(mode=0o700)
            admissions, completions, _ = proof.CASES[name]
            uuid = f"{index + 1:08x}-1111-4111-8111-111111111111"
            cause = "NORMAL_CLEARING" if name == "answered" else "NO_ANSWER"
            prefix = (f"{uuid} 2026-09-26 15:43:13.215664 100.00% "
                      "[NOTICE] mod_dptools.c:1865 ")
            trace = (f"{prefix}PHONE11_VM_PROBE case={name} uuid={uuid} "
                     f"cause={cause} stage=before_lua\n"
                     f"{prefix}PHONE11_VM_PROBE case={name} uuid={uuid} "
                     f"cause={cause} stage=after_lua\n").encode()
            if name == "caller_hangup":
                ended_at = "2026-09-26 15:43:21.235664"
                trace = (f"{prefix}PHONE11_VM_PROBE case=caller_hangup "
                         f"uuid={uuid} cause=NO_ANSWER stage=before_lua\n"
                         f"{uuid} 2026-09-26 15:43:21.215664 95.27% "
                         "[NOTICE] mod_loopback.c:585 Hangup loopback/9903-b "
                         "[CS_EXECUTE] [NORMAL_CLEARING]\n"
                         "2026-09-26 15:43:21.215664 95.27% [DEBUG] "
                         "mod_voicemail.c:2832 Deliver VM to 9001@probe.invalid\n"
                         f"{uuid} {ended_at} 95.27% [NOTICE] "
                         "switch_core_session.c:1762 Session 6 (loopback/9903-b) Ended\n").encode()
            elif name == "early_abandon":
                trace = (f"{prefix}PHONE11_VM_PROBE case=early_abandon "
                         f"uuid={uuid} cause=NO_ANSWER stage=before_lua\n"
                         f"{uuid} 2026-09-26 15:43:13.335664 95.27% "
                         "[NOTICE] mod_loopback.c:585 Hangup loopback/9904-b "
                         "[CS_EXECUTE] [NORMAL_CLEARING]\n"
                         f"{uuid} 2026-09-26 15:43:13.335664 95.27% [NOTICE] "
                         "switch_core_session.c:1762 Session 8 (loopback/9904-b) Ended\n").encode()
            write_private(directory / "fs-trace.log", trace)
            console.extend(trace)
            transcript.append(f"case={name} caller_uuid={uuid} bgapi=accepted")
            if name == "early_abandon":
                transcript.append("case=early_abandon "
                                  "mailbox_inventory_unchanged_sha256=" + SHA(b"prior wavs\n"))
            marker = {"admissions": admissions, "completions": completions,
                      "admit_sha256": None, "complete_sha256": None,
                      "wav_sha256": SHA(wav) if completions else None,
                      "media_snapshot_sha256": None,
                      "trace_sha256": SHA(trace), "call_uuid": uuid,
                      "source_sha": SOURCE, "image_id": IMAGE}
            self.receipt["cases"][name] = marker
            if admissions:
                admit_raw = json.dumps({"channelUuid": uuid, "tenantId": 1,
                                        "extension": "3001"}).encode()
                write_private(directory / "admit.json", admit_raw)
                marker["admit_sha256"] = SHA(admit_raw)
                if completions:
                    complete_raw = json.dumps({
                        "channelUuid": uuid, "voicemailFilePath": "/probe/mailbox/final.wav",
                        "callerNumber": "1020", "durationSeconds": 2}).encode()
                    write_private(directory / "complete.json", complete_raw)
                    marker["complete_sha256"] = SHA(complete_raw)
                    (directory / "media").mkdir(mode=0o700)
                    (directory / "media" / "mailbox").mkdir(mode=0o700)
                    media = directory / "media" / "mailbox" / "final.wav"
                    write_private(media, wav)
                    completed_at = (directory / "complete.json").stat().st_mtime_ns
                    os.utime(media, ns=(completed_at, completed_at))
                    snapshot = (f"path=/probe/mailbox/final.wav\nsha256={SHA(wav)}\n"
                                f"size={len(wav)}\nmtime={int(media.stat().st_mtime)}\n"
                                f"complete_mtime={int((directory / 'complete.json').stat().st_mtime)}\n"
                                f"observed={int(time.time())}\n").encode()
                    write_private(directory / "complete-media.txt", snapshot)
                    marker["media_snapshot_sha256"] = SHA(snapshot)
        write_private(self.root / "clone-console.log", bytes(console))
        write_private(self.root / "loaded-dialplan.xml",
                      harness.fixture_files()["dialplan/probe.xml"])
        write_private(self.root / "harness-transcript.log",
                      ("\n".join(transcript) + "\n").encode())
        write_private(self.root / "clone-harness.py",
                      (ROOT / "tests/phone11-voicemail-callback-clone.py").read_bytes())
        self.save()

    def tearDown(self):
        self.temp.cleanup()
        self.review_temp.cleanup()

    def save(self):
        inspect_bytes = json.dumps(self.inspect, sort_keys=True).encode()
        write_private(self.root / "clone-inspect.json", inspect_bytes)
        self.receipt["clone_inspect_sha256"] = SHA(inspect_bytes)
        self.receipt["fs_version_sha256"] = SHA((self.root / "fs-version.txt").read_bytes())
        for filename, field in (("clone-console.log", "clone_console_sha256"),
                                ("loaded-dialplan.xml", "loaded_dialplan_sha256"),
                                ("harness-transcript.log", "harness_transcript_sha256"),
                                ("clone-harness.py", "clone_harness_sha256")):
            self.receipt[field] = SHA((self.root / filename).read_bytes())
        receipt_bytes = json.dumps(self.receipt, sort_keys=True).encode()
        self.path = self.root / "callback.json"
        write_private(self.path, receipt_bytes)
        self.digest = SHA(receipt_bytes)

    def validate(self):
        return proof.validate_callback_proof(self.path, self.digest, SOURCE, IMAGE, NOW)

    def test_exact_private_four_case_evidence_passes(self):
        self.assertEqual(self.validate()["result"], "isolated_callback_verified")

    def test_receipt_builder_requires_raw_evidence_and_is_immutable(self):
        self.path.unlink()
        path, digest = proof.create_callback_receipt(self.root, SOURCE, IMAGE, NOW)
        self.assertEqual(path, self.root / "callback.json")
        self.assertEqual(proof.validate_callback_proof(path, digest, SOURCE, IMAGE, NOW)["result"],
                         "isolated_callback_verified")
        with self.assertRaisesRegex(proof.ProofError, "callback_root_files"):
            proof.create_callback_receipt(self.root, SOURCE, IMAGE, NOW)

    def test_wrong_source_image_receipt_or_freshness_fails(self):
        with self.assertRaisesRegex(proof.ProofError, "callback_expected_pin"):
            proof.validate_callback_proof(self.path, self.digest, "invalid", IMAGE, NOW)
        with self.assertRaisesRegex(proof.ProofError, "callback_source_image_pin"):
            proof.validate_callback_proof(self.path, self.digest, SOURCE, "sha256:changed", NOW)
        with self.assertRaisesRegex(proof.ProofError, "callback_receipt_pin"):
            proof.validate_callback_proof(self.path, "0" * 64, SOURCE, IMAGE, NOW)
        with self.assertRaisesRegex(proof.ProofError, "callback_receipt_freshness"):
            proof.validate_callback_proof(self.path, self.digest, SOURCE, IMAGE,
                                          NOW + proof.MAX_AGE_SECONDS + 1)

    def test_isolation_and_raw_artifacts_are_required(self):
        self.inspect["HostConfig"]["NetworkMode"] = "host"
        self.save()
        with self.assertRaisesRegex(proof.ProofError, "callback_clone_isolation"):
            self.validate()
        self.inspect["HostConfig"]["NetworkMode"] = "none"
        self.inspect["Config"]["Env"].append("FS_SHARED_SECRET=redacted")
        self.save()
        with self.assertRaisesRegex(proof.ProofError, "callback_clone_credentials"):
            self.validate()
        self.inspect["Config"]["Env"].pop()
        self.save()
        bad = self.root / "caller_hangup" / "media" / "mailbox" / "final.wav"
        write_private(bad, b"RIFFnot-a-wave")
        self.receipt["cases"]["caller_hangup"]["wav_sha256"] = SHA(b"RIFFnot-a-wave")
        snapshot = (f"path=/probe/mailbox/final.wav\nsha256={SHA(b'RIFFnot-a-wave')}\n"
                    f"size={len(b'RIFFnot-a-wave')}\nmtime={int(bad.stat().st_mtime)}\n"
                    f"complete_mtime={int((self.root / 'caller_hangup' / 'complete.json').stat().st_mtime)}\n"
                    f"observed={int(time.time())}\n").encode()
        write_private(self.root / "caller_hangup" / "complete-media.txt", snapshot)
        self.receipt["cases"]["caller_hangup"]["media_snapshot_sha256"] = SHA(snapshot)
        self.save()
        with self.assertRaisesRegex(proof.ProofError, "callback_wav_header"):
            self.validate()

    def test_completion_must_name_the_exact_captured_wav(self):
        directory = self.root / "caller_hangup"
        complete = json.loads((directory / "complete.json").read_bytes())
        complete["voicemailFilePath"] = "/probe/other/final.wav"
        raw = json.dumps(complete).encode()
        write_private(directory / "complete.json", raw)
        self.receipt["cases"]["caller_hangup"]["complete_sha256"] = SHA(raw)
        self.save()
        with self.assertRaisesRegex(proof.ProofError, "callback_media_identity"):
            self.validate()
        snapshot = (directory / "complete-media.txt").read_bytes().replace(
            b"/probe/mailbox/final.wav", b"/probe/other/final.wav")
        write_private(directory / "complete-media.txt", snapshot)
        self.receipt["cases"]["caller_hangup"]["media_snapshot_sha256"] = SHA(snapshot)
        self.save()
        with self.assertRaisesRegex(proof.ProofError, "callback_media_files|callback_file_privacy|callback_directory_privacy"):
            self.validate()

    def test_answered_requires_distinct_raw_call_trace(self):
        trace = self.root / "answered" / "fs-trace.log"
        trace.unlink()
        with self.assertRaisesRegex(proof.ProofError, "callback_case_files|callback_file_privacy"):
            self.validate()
        copied = (self.root / "no_answer_dtmf" / "fs-trace.log").read_bytes()
        write_private(trace, copied)
        console = self.root / "clone-console.log"
        write_private(console, console.read_bytes().replace(
            b"PHONE11_VM_PROBE case=answered", b"PHONE11_VM_PROBE case=no_answer_dtmf"))
        self.receipt["cases"]["answered"]["trace_sha256"] = SHA(copied)
        self.save()
        with self.assertRaisesRegex(proof.ProofError, "callback_console_marker_count|callback_console_trace_binding"):
            self.validate()

    def test_raw_console_and_loaded_dialplan_are_bound(self):
        console = self.root / "clone-console.log"
        write_private(console, console.read_bytes().replace(b"stage=after_lua",
                                                          b"stage=missing", 1))
        self.save()
        with self.assertRaisesRegex(proof.ProofError, "callback_console_trace_binding"):
            self.validate()
        write_private(console, b"".join((self.root / name / "fs-trace.log").read_bytes()
                                         for name in proof.CASES))
        loaded = self.root / "loaded-dialplan.xml"
        write_private(loaded, loaded.read_bytes().replace(b"stage=after_lua",
                                                        b"stage=missing", 1))
        self.save()
        with self.assertRaisesRegex(proof.ProofError, "callback_loaded_dialplan"):
            self.validate()

    def test_planned_and_execute_log_echoes_are_not_callback_events(self):
        answered = self.root / "answered" / "fs-trace.log"
        actual = answered.read_bytes().splitlines()[1] + b"\n"
        planned = (b"Dialplan: ... Action log(NOTICE PHONE11_VM_PROBE "
                   b"case=answered uuid=${uuid} cause=${bridge_hangup_cause} "
                   b"stage=after_lua)\n")
        execute = (b"EXECUTE [depth=0] ... log(NOTICE PHONE11_VM_PROBE "
                   b"case=answered uuid=... stage=after_lua)\n")
        write_private(answered, answered.read_bytes().replace(actual, planned + execute))
        console = self.root / "clone-console.log"
        write_private(console, console.read_bytes().replace(actual, planned + execute))
        self.receipt["cases"]["answered"]["trace_sha256"] = SHA(answered.read_bytes())
        self.save()
        with self.assertRaisesRegex(proof.ProofError, "callback_console_marker_count"):
            self.validate()

    def test_console_may_contain_planned_actions_but_only_six_emitted_notices(self):
        console = self.root / "clone-console.log"
        write_private(console, console.read_bytes() +
                      b"Dialplan: ... Action log(NOTICE PHONE11_VM_PROBE case=answered "
                      b"uuid=${uuid} stage=before_lua)\n"
                      b"EXECUTE [depth=0] ... log(NOTICE PHONE11_VM_PROBE "
                      b"case=answered stage=after_lua)\n")
        self.save()
        self.validate()

    def test_caller_hangup_requires_same_leg_hangup_delivery_and_end(self):
        path = self.root / "caller_hangup" / "fs-trace.log"
        original = path.read_bytes()
        console = self.root / "clone-console.log"
        for replacement in (
            original.replace(b"mod_loopback.c:585", b"mod_dptools.c:585"),
            original.replace(b"Deliver VM to 9001@probe.invalid",
                             b"Deliver VM to 9002@probe.invalid"),
            original.replace(b"loopback/9903-b", b"loopback/9902-b"),
            original.replace(b"15:43:21.215664 95.27% [DEBUG]",
                             b"15:43:23.215664 95.27% [DEBUG]"),
            original.replace(b"Session 6 (loopback/9903-b) Ended",
                             b"Session 6 (loopback/9903-b) Missing"),
        ):
            write_private(path, replacement)
            write_private(console, console.read_bytes().replace(original, replacement))
            self.receipt["cases"]["caller_hangup"]["trace_sha256"] = SHA(replacement)
            self.save()
            with self.assertRaisesRegex(proof.ProofError,
                                        "callback_console_trace_binding|callback_hangup_outcome"):
                self.validate()
            write_private(console, console.read_bytes().replace(replacement, original))
        write_private(path, original)

    def test_early_abandon_requires_same_leg_end_without_delivery_or_media(self):
        path = self.root / "early_abandon" / "fs-trace.log"
        original = path.read_bytes()
        console = self.root / "clone-console.log"
        original_console = console.read_bytes()
        for replacement in (
            original.replace(b"mod_loopback.c:585", b"mod_dptools.c:585"),
            original.replace(b"loopback/9904-b", b"loopback/9903-b"),
            original.replace(b"15:43:13.335664", b"15:43:16.335664"),
            original.replace(b"Session 8 (loopback/9904-b) Ended",
                             b"Session 8 (loopback/9904-b) Missing"),
            original + b"2026-09-26 15:43:13.335664 95.27% [DEBUG] "
                       b"mod_voicemail.c:2832 Deliver VM to 9001@probe.invalid\n",
        ):
            write_private(path, replacement)
            write_private(console, original_console.replace(original, replacement))
            self.receipt["cases"]["early_abandon"]["trace_sha256"] = SHA(replacement)
            self.save()
            with self.assertRaisesRegex(proof.ProofError,
                                        "callback_console_trace_binding|callback_abandon_outcome"):
                self.validate()
        write_private(path, original)
        write_private(console, original_console)
        self.receipt["cases"]["early_abandon"]["trace_sha256"] = SHA(original)
        transcript = self.root / "harness-transcript.log"
        write_private(transcript, transcript.read_bytes().replace(
            b"case=early_abandon mailbox_inventory_unchanged_sha256=",
            b"case=early_abandon mailbox_inventory_changed_sha256="))
        self.save()
        with self.assertRaisesRegex(proof.ProofError, "callback_abandon_mailbox_inventory"):
            self.validate()

    def test_harness_bytes_are_exactly_pinned(self):
        harness_copy = self.root / "clone-harness.py"
        write_private(harness_copy, harness_copy.read_bytes() + b"\n")
        self.save()
        with self.assertRaisesRegex(proof.ProofError, "callback_harness_source_pin"):
            self.validate()

    def test_duplicate_call_identity_and_media_order_fail(self):
        answered = self.root / "answered" / "fs-trace.log"
        original = answered.read_bytes()
        other_uuid = self.receipt["cases"]["no_answer_dtmf"]["call_uuid"].encode()
        duplicate = original.replace(self.receipt["cases"]["answered"]["call_uuid"].encode(),
                                     other_uuid)
        write_private(answered, duplicate)
        console = self.root / "clone-console.log"
        write_private(console, console.read_bytes().replace(original, duplicate))
        self.receipt["cases"]["answered"]["call_uuid"] = other_uuid.decode()
        self.receipt["cases"]["answered"]["trace_sha256"] = SHA(duplicate)
        self.save()
        with self.assertRaisesRegex(proof.ProofError, "callback_case_reused_call"):
            self.validate()
        write_private(answered, original)
        write_private(console, console.read_bytes().replace(duplicate, original))
        self.receipt["cases"]["answered"]["call_uuid"] = original.decode().split("uuid=")[1].split()[0]
        self.receipt["cases"]["answered"]["trace_sha256"] = SHA(original)
        snapshot = self.root / "caller_hangup" / "complete-media.txt"
        previous = snapshot.read_bytes()
        prior_time = next(line for line in previous.splitlines()
                          if line.startswith(b"complete_mtime="))
        altered = previous.replace(prior_time,
                                   f"complete_mtime={NOW + 100}".encode())
        self.assertNotEqual(altered, previous)
        write_private(snapshot, altered)
        self.receipt["cases"]["caller_hangup"]["media_snapshot_sha256"] = SHA(altered)
        self.save()
        with self.assertRaisesRegex(proof.ProofError, "callback_media_order"):
            self.validate()

    def test_missing_extra_or_public_artifacts_fail_closed(self):
        extra = self.root / "answered" / "complete.json"
        write_private(extra, b"{}")
        with self.assertRaisesRegex(proof.ProofError, "callback_case_files"):
            self.validate()
        extra.unlink()
        file = self.root / "early_abandon" / "admit.json"
        os.chmod(file, 0o644)
        with self.assertRaisesRegex(proof.ProofError, "callback_file_privacy"):
            self.validate()
        os.chmod(file, 0o600)
        self.receipt["cases"]["early_abandon"]["extra"] = True
        self.save()
        with self.assertRaisesRegex(proof.ProofError, "callback_case_marker"):
            self.validate()

    def test_each_case_has_its_own_pinned_source_and_fresh_events(self):
        self.receipt["cases"]["no_answer_dtmf"]["image_id"] = "sha256:" + "0" * 64
        self.save()
        with self.assertRaisesRegex(proof.ProofError, "callback_case_count"):
            self.validate()
        self.receipt["cases"]["no_answer_dtmf"]["image_id"] = IMAGE
        self.save()
        admit = self.root / "no_answer_dtmf" / "admit.json"
        write_private(admit, admit.read_bytes() + b" ")
        with self.assertRaisesRegex(proof.ProofError, "callback_admission_pin"):
            self.validate()
        self.receipt["cases"]["no_answer_dtmf"]["admit_sha256"] = SHA(admit.read_bytes())
        self.save()
        os.utime(admit, (NOW - proof.MAX_AGE_SECONDS - 2,
                         NOW - proof.MAX_AGE_SECONDS - 2))
        with self.assertRaisesRegex(proof.ProofError, "callback_artifact_freshness"):
            self.validate()

    def test_handoff_stays_blocked_after_structural_proof(self):
        backend = {"Id": handoff.clone.ACTIVE_BACKEND_ID,
                   "Image": handoff.clone.ACTIVE_BACKEND_IMAGE,
                   "State": {"Running": True, "Health": {"Status": "healthy"}},
                   "Config": {"Env": ["PHONE11_VOICEMAIL_HOOK_READY=false"]}}
        freeswitch = {"Id": handoff.clone.ACTIVE_FREESWITCH_ID,
                      "Image": IMAGE,
                      "State": {"Running": True, "Health": {"Status": "healthy"}},
                      "Mounts": [{"Name": "phone11ai-voip_fs_voicemail",
                                  "Destination": "/var/lib/freeswitch/voicemail", "RW": True}]}
        absent = {key: False for key in
                  ("admissions", "messages", "owner_epoch", "owner_trigger", "guard_trigger",
                   "owner_function", "guard_function", "admissions_index", "inbox_index")}
        def invoke(review_path=None, review_digest=None):
            with patch.object(handoff, "private_receipt"), \
                 patch.object(handoff, "docker_json", side_effect=[backend, freeswitch]), \
                 patch.object(handoff.proof.time, "time", return_value=NOW), \
                 patch.object(handoff.clone, "run", side_effect=[json.dumps(absent), "",
                        "loaded_xml_no_hook modules_loaded"]):
                return handoff.check_handoff(Path("/private/clone.json"), self.path,
                                             self.digest, SOURCE, review_path, review_digest)

        with self.assertRaisesRegex(handoff.clone.ValidationError,
                                    "callback_independent_review_pending"):
            invoke()
        review = {"schema": "phone11.fs-callback-independent-review/v1",
                  "callback_proof_sha256": self.digest,
                  "source_sha": SOURCE, "freeswitch_image": IMAGE,
                  "reviewed_at_unix": NOW, "reviewer": "Independent Reviewer",
                  "finding": "approved"}
        for field in ("clone_console_sha256", "loaded_dialplan_sha256",
                      "harness_transcript_sha256", "clone_harness_sha256"):
            review[field] = self.receipt[field]
        review_path = Path(self.review_temp.name) / "review.json"
        raw = json.dumps(review).encode()
        write_private(review_path, raw)
        with self.assertRaisesRegex(handoff.clone.ValidationError, "callback_review_pin"):
            invoke(review_path, "0" * 64)
        result = invoke(review_path, SHA(raw))
        self.assertEqual(result["result"], "hook_off_handoff_ready")
        self.assertEqual(result["review"], "operator_recorded_independent_review")
        review["finding"] = "rejected"
        raw = json.dumps(review).encode()
        write_private(review_path, raw)
        with self.assertRaisesRegex(handoff.clone.ValidationError,
                                    "callback_independent_review_pending"):
            invoke(review_path, SHA(raw))


if __name__ == "__main__":
    unittest.main()
