"""Source checks for the disposable clone plan; not a FreeSWITCH run."""

import importlib.util
import hashlib
from pathlib import Path
import os
from types import SimpleNamespace
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET


SCRIPT = Path(__file__).with_name("phone11-voicemail-callback-clone.py")
spec = importlib.util.spec_from_file_location("phone11_voicemail_clone_test", SCRIPT)
assert spec and spec.loader
clone = importlib.util.module_from_spec(spec)
spec.loader.exec_module(clone)


class CallbackCloneSourceTest(unittest.TestCase):
    def test_mailbox_inventory_rejects_missing_or_linked_final_wav(self):
        path = "/probe/mailbox/final.wav"
        digest = "a" * 64
        with patch.object(clone, "run_raw", return_value=(path + "\0").encode()), \
             patch.object(clone.subprocess, "run", side_effect=[
                 SimpleNamespace(returncode=0), SimpleNamespace(returncode=1)]), \
             patch.object(clone, "run", side_effect=[digest + "  " + path,
                 "32044 2026-09-26 16:06:22.123456789 +0000 "
                 "2026-09-26 16:06:22.123456789 +0000"]):
            inventory = clone.mailbox_inventory("clone")
        self.assertIn(path.encode(), inventory)
        self.assertIn(digest.encode(), inventory)
        with patch.object(clone, "run_raw", return_value=(path + "\0").encode()), \
             patch.object(clone.subprocess, "run", side_effect=[
                 SimpleNamespace(returncode=0), SimpleNamespace(returncode=0)]):
            with self.assertRaisesRegex(clone.CloneError, "mailbox_inventory_not_plain"):
                clone.mailbox_inventory("clone")
        with patch.object(clone, "run_raw", side_effect=clone.CloneError("find failed")):
            with self.assertRaisesRegex(clone.CloneError, "find failed"):
                clone.mailbox_inventory("clone")

    def test_early_abandon_evidence_requires_b_leg_end_without_delivery(self):
        uuid = "78d021e0-69cc-44d5-9cde-997ea8511d49"
        before = (f"{uuid} 2026-09-26 16:06:22.288685 95.73% "
                  f"[NOTICE] mod_dptools.c:1865 PHONE11_VM_PROBE case=early_abandon "
                  f"uuid={uuid} cause=NO_ANSWER stage=before_lua")
        hangup = (f"{uuid} 2026-09-26 16:06:22.408688 95.73% [NOTICE] "
                  "mod_loopback.c:585 Hangup loopback/9904-b "
                  "[CS_EXECUTE] [NORMAL_CLEARING]")
        ended = (f"{uuid} 2026-09-26 16:06:22.408688 95.73% [NOTICE] "
                 "switch_core_session.c:1762 Session 8 (loopback/9904-b) Ended")
        raw = "\n".join((before, hangup, ended))
        self.assertEqual(clone.early_abandon_evidence(raw), [before, hangup, ended])
        self.assertIsNone(clone.early_abandon_evidence(raw.replace(
            "mod_loopback.c:585", "mod_dptools.c:585")))
        self.assertIsNone(clone.early_abandon_evidence(raw +
            "\n2026-09-26 16:06:22.408688 95.73% [DEBUG] "
            "mod_voicemail.c:2832 Deliver VM to 9001@probe.invalid"))

    def test_hangup_evidence_binds_b_leg_delivery_and_session_end(self):
        uuid = "b88cb423-5026-483d-9897-a8829feea977"
        before = (f"{uuid} 2026-09-26 15:43:13.215664 100.00% "
                  f"[NOTICE] mod_dptools.c:1865 PHONE11_VM_PROBE case=caller_hangup "
                  f"uuid={uuid} cause=NO_ANSWER stage=before_lua")
        hangup = (f"{uuid} 2026-09-26 15:43:21.215664 95.27% [NOTICE] "
                  "mod_loopback.c:585 Hangup loopback/9903-b "
                  "[CS_EXECUTE] [NORMAL_CLEARING]")
        delivery = ("2026-09-26 15:43:21.215664 95.27% [DEBUG] "
                    "mod_voicemail.c:2832 Deliver VM to 9001@probe.invalid")
        ended = (f"{uuid} 2026-09-26 15:43:21.235664 95.27% [NOTICE] "
                 "switch_core_session.c:1762 Session 6 (loopback/9903-b) Ended")
        self.assertEqual(clone.caller_hangup_evidence(
            "\n".join((before, hangup, delivery, ended))),
            [before, hangup, delivery, ended])
        self.assertIsNone(clone.caller_hangup_evidence(
            "\n".join((before, hangup, ended))))
        self.assertIsNone(clone.caller_hangup_evidence(
            "\n".join((before, hangup.replace(uuid, "a" * 36), delivery, ended))))

    def test_probe_trace_requires_emitted_notice_not_dialplan_or_execute_echo(self):
        uuid = "b88cb423-5026-483d-9897-a8829feea977"
        marker = (f"PHONE11_VM_PROBE case=answered uuid={uuid} "
                  "cause=NORMAL_CLEARING stage=after_lua")
        emitted = (f"{uuid} 2026-09-26 15:43:13.215664 100.00% "
                   f"[NOTICE] mod_dptools.c:1865 {marker}")
        self.assertTrue(clone.emitted_probe_notice(emitted, "answered"))
        self.assertFalse(clone.emitted_probe_notice(emitted, "caller_hangup"))
        self.assertFalse(clone.emitted_probe_notice(
            f"Dialplan: loopback/9901 Action log(NOTICE {marker})", "answered"))
        self.assertFalse(clone.emitted_probe_notice(
            f"EXECUTE [depth=0] loopback/9901 log(NOTICE {marker})", "answered"))

    def test_fixture_has_four_isolated_routes_and_no_sip_profile(self):
        files = clone.fixture_files()
        self.assertEqual(set(files), {"freeswitch.xml", "vars.xml",
            "autoload_configs/modules.conf.xml", "autoload_configs/event_socket.conf.xml",
            "autoload_configs/console.conf.xml", "autoload_configs/logfile.conf.xml",
            "autoload_configs/switch.conf.xml",
            "autoload_configs/voicemail.conf.xml", "directory/probe.xml",
            "dialplan/probe.xml", "lang/en.xml"})
        for name, raw in files.items():
            if name.endswith(".xml"):
                ET.fromstring(raw)
        for line in files["freeswitch.xml"].decode().splitlines():
            if "X-PRE-PROCESS" in line:
                self.assertTrue(line.strip().startswith("<X-PRE-PROCESS"))
                self.assertNotIn("<section", line)
        directory_lines = [line.strip() for line in
                           files["directory/probe.xml"].decode().splitlines()]
        self.assertIn("<include>", directory_lines)
        self.assertIn("<domain name=\"probe.invalid\">", directory_lines)
        self.assertIn("</include>", directory_lines)
        self.assertLess(directory_lines.index("<include>"),
                        directory_lines.index("<domain name=\"probe.invalid\">"))
        language_lines = [line.strip() for line in files["lang/en.xml"].decode().splitlines()]
        self.assertIn("<include>", language_lines)
        self.assertIn('<language name="en">', language_lines)
        self.assertLess(language_lines.index("<include>"),
                        language_lines.index('<language name="en">'))
        macros = ET.fromstring(files["lang/en.xml"]).findall(
            "./language/phrases/macros/macro")
        self.assertEqual({macro.get("name") for macro in macros},
                         {"voicemail_play_greeting", "voicemail_record_message"})
        self.assertTrue(all(macro.find("./input/match/action").get("data") ==
                            "sleep(100)" for macro in macros))
        self.assertIn(b'data="default_language=en"', files["vars.xml"])
        self.assertNotIn(b"mod_sofia", files["autoload_configs/modules.conf.xml"])
        self.assertIn(b'module="mod_logfile"', files["autoload_configs/modules.conf.xml"])
        self.assertIn(b'value="/probe/log/freeswitch.log"',
                      files["autoload_configs/logfile.conf.xml"])
        self.assertIn(b'value="/probe/mailbox"', files["autoload_configs/voicemail.conf.xml"])
        routes = ET.fromstring(files["dialplan/probe.xml"]).findall("./extension")
        self.assertEqual(len(routes), 4)
        for route, case in zip(routes, clone.CASES):
            actions = [(item.get("application"), item.get("data"))
                       for item in route.findall("./condition/action")]
            self.assertEqual([item[0] for item in actions],
                             ["answer", "set", "set", "set", "set", "set",
                              "log", "lua", "log", "hangup"])
            self.assertEqual(actions[1:5], [("set", "language=en"),
                ("set", "skip_record_check=true"),
                ("set", "skip_record_urgent_check=true"),
                ("set", "voicemail_skip_goodbye=true")])
            self.assertIn(f"case={case}", actions[6][1])
            self.assertIn("stage=before_lua", actions[6][1])
            self.assertIn("stage=after_lua", actions[8][1])

    def test_effective_xml_guard_rejects_flattened_sections_or_load_all(self):
        files = clone.fixture_files()
        root = ET.Element("document", {"type": "freeswitch/xml"})
        configuration = ET.SubElement(root, "section", {"name": "configuration"})
        configuration.append(ET.fromstring(files["autoload_configs/modules.conf.xml"]))
        configuration.append(ET.fromstring(files["autoload_configs/logfile.conf.xml"]))
        dialplan = ET.SubElement(root, "section", {"name": "dialplan"})
        dialplan.append(ET.fromstring(files["dialplan/probe.xml"]))
        directory = ET.SubElement(root, "section", {"name": "directory"})
        for domain in ET.fromstring(files["directory/probe.xml"]):
            directory.append(domain)
        languages = ET.SubElement(root, "section", {"name": "languages"})
        languages.extend(ET.fromstring(files["lang/en.xml"]))
        clone.verify_effective_config(ET.tostring(root, encoding="unicode"), files)
        flattened = ET.Element("document", {"type": "freeswitch/xml"})
        flattened.append(ET.fromstring(files["autoload_configs/modules.conf.xml"]))
        with self.assertRaisesRegex(clone.CloneError, "effective_xml_section"):
            clone.verify_effective_config(ET.tostring(flattened, encoding="unicode"), files)
        ET.SubElement(configuration.find("./configuration/modules"), "load",
                      {"module": "mod_sofia"})
        with self.assertRaisesRegex(clone.CloneError, "effective_modules_list"):
            clone.verify_effective_config(ET.tostring(root, encoding="unicode"), files)

    def test_effective_xml_guard_requires_file_logger_path(self):
        files = clone.fixture_files()
        root = ET.Element("document", {"type": "freeswitch/xml"})
        configuration = ET.SubElement(root, "section", {"name": "configuration"})
        configuration.append(ET.fromstring(files["autoload_configs/modules.conf.xml"]))
        logger = ET.fromstring(files["autoload_configs/logfile.conf.xml"])
        configuration.append(logger)
        dialplan = ET.SubElement(root, "section", {"name": "dialplan"})
        dialplan.append(ET.fromstring(files["dialplan/probe.xml"]))
        directory = ET.SubElement(root, "section", {"name": "directory"})
        directory.extend(ET.fromstring(files["directory/probe.xml"]))
        languages = ET.SubElement(root, "section", {"name": "languages"})
        languages.extend(ET.fromstring(files["lang/en.xml"]))
        clone.verify_effective_config(ET.tostring(root, encoding="unicode"), files)
        logger.find("./profiles/profile/settings/param[@name='logfile']").set(
            "value", "/dev/null")
        with self.assertRaisesRegex(clone.CloneError, "effective_file_logger"):
            clone.verify_effective_config(ET.tostring(root, encoding="unicode"), files)

    def test_effective_xml_guard_requires_expanded_directory_domain(self):
        files = clone.fixture_files()
        root = ET.Element("document", {"type": "freeswitch/xml"})
        configuration = ET.SubElement(root, "section", {"name": "configuration"})
        configuration.append(ET.fromstring(files["autoload_configs/modules.conf.xml"]))
        configuration.append(ET.fromstring(files["autoload_configs/logfile.conf.xml"]))
        dialplan = ET.SubElement(root, "section", {"name": "dialplan"})
        dialplan.append(ET.fromstring(files["dialplan/probe.xml"]))
        directory = ET.SubElement(root, "section", {"name": "directory"})
        languages = ET.SubElement(root, "section", {"name": "languages"})
        languages.extend(ET.fromstring(files["lang/en.xml"]))
        with self.assertRaisesRegex(clone.CloneError, "effective_call_sections"):
            clone.verify_effective_config(ET.tostring(root, encoding="unicode"), files)
        directory.extend(ET.fromstring(files["directory/probe.xml"]))
        clone.verify_effective_config(ET.tostring(root, encoding="unicode"), files)
        domain = directory.find("./domain")
        domain.set("name", "other.invalid")
        with self.assertRaisesRegex(clone.CloneError, "effective_call_sections"):
            clone.verify_effective_config(ET.tostring(root, encoding="unicode"), files)

    def test_effective_xml_guard_requires_recording_prompt_macros(self):
        files = clone.fixture_files()
        root = ET.Element("document", {"type": "freeswitch/xml"})
        configuration = ET.SubElement(root, "section", {"name": "configuration"})
        configuration.append(ET.fromstring(files["autoload_configs/modules.conf.xml"]))
        configuration.append(ET.fromstring(files["autoload_configs/logfile.conf.xml"]))
        dialplan = ET.SubElement(root, "section", {"name": "dialplan"})
        dialplan.append(ET.fromstring(files["dialplan/probe.xml"]))
        directory = ET.SubElement(root, "section", {"name": "directory"})
        directory.extend(ET.fromstring(files["directory/probe.xml"]))
        languages = ET.SubElement(root, "section", {"name": "languages"})
        languages.extend(ET.fromstring(files["lang/en.xml"]))
        clone.verify_effective_config(ET.tostring(root, encoding="unicode"), files)
        macros = languages.find("./language/phrases/macros")
        macros.remove(macros.find("./macro[@name='voicemail_record_message']"))
        with self.assertRaisesRegex(clone.CloneError, "effective_probe_language"):
            clone.verify_effective_config(ET.tostring(root, encoding="unicode"), files)

    def test_non_linux_execution_fails_before_docker_or_output(self):
        with tempfile.TemporaryDirectory() as folder, \
             patch.object(clone.sys, "platform", "darwin"), \
             patch.object(clone, "run") as command:
            output = Path(folder) / "evidence"
            with self.assertRaisesRegex(clone.CloneError, "linux_root_required"):
                clone.execute(output, "a" * 40)
            self.assertFalse(output.exists())
            command.assert_not_called()

    def test_private_parent_and_exact_clean_source_are_required(self):
        with tempfile.TemporaryDirectory() as folder, \
             patch.object(clone.sys, "platform", "linux"), \
             patch.object(clone.os, "geteuid", return_value=0), \
             patch.object(clone, "run") as command:
            output = Path(folder) / "evidence"
            with self.assertRaisesRegex(clone.CloneError,
                                        "private_output_parent_required"):
                clone.execute(output, "a" * 40)
            command.assert_not_called()

    def test_fixture_archive_contains_only_private_relative_config(self):
        files = clone.fixture_files()
        archive = clone.fixture_archive(files)
        with tempfile.TemporaryFile() as output:
            output.write(archive)
            output.seek(0)
            with tarfile.open(fileobj=output) as tar:
                members = tar.getmembers()
                self.assertEqual({member.name for member in members if member.isfile()},
                                 {"conf/" + name for name in files})
                for member in members:
                    self.assertFalse(member.name.startswith("/"))
                    self.assertNotIn("..", Path(member.name).parts)
                    self.assertTrue(member.isdir() or member.isfile())
                    self.assertEqual(member.mode, 0o700 if member.isdir() else 0o600)
                    if member.isfile():
                        self.assertEqual(tar.extractfile(member).read(),
                                         files[member.name.removeprefix("conf/")])
        with self.assertRaisesRegex(clone.CloneError, "unsafe_fixture_path"):
            clone.fixture_archive({"../escape.xml": b"x"})

    def test_tmpfs_fixture_staging_checks_every_file_and_mode(self):
        files = {"dialplan/probe.xml": b"<context/>"}
        transcript = []
        with patch.object(clone.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as tar, \
             patch.object(clone, "run_raw", return_value=files["dialplan/probe.xml"]) as read, \
             patch.object(clone, "run", side_effect=["600", "700", "700"]):
            clone.stage_fixture("clone", files, transcript)
        self.assertEqual(tar.call_args.args[0][:5],
                         ["docker", "exec", "-i", "clone", "tar"])
        self.assertTrue(tar.call_args.kwargs["input"])
        read.assert_called_once_with(["docker", "exec", "clone", "cat",
                                      "/probe/conf/dialplan/probe.xml"])
        self.assertIn("copy=fixture_config", transcript[0])
        with patch.object(clone.subprocess, "run", return_value=SimpleNamespace(returncode=0)), \
             patch.object(clone, "run_raw", return_value=b""):
            with self.assertRaisesRegex(clone.CloneError, "fixture_staging_mismatch"):
                clone.stage_fixture("clone", files, [])
        with patch.object(clone.subprocess, "run", return_value=SimpleNamespace(returncode=1)):
            with self.assertRaisesRegex(clone.CloneError, "fixture_tar_failed"):
                clone.stage_fixture("clone", files, [])

    def test_tmpfs_file_copy_preserves_verified_bytes_and_timestamp(self):
        media = b"RIFF"
        digest = hashlib.sha256(media).hexdigest()
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "final.wav"
            with patch.object(clone.subprocess, "run", return_value=SimpleNamespace(returncode=0)), \
                 patch.object(clone, "run", side_effect=["4 1700000000", digest,
                                                       "4 1700000000", digest]), \
                 patch.object(clone, "run_raw", return_value=media):
                transcript = []
                clone.copy_tmpfs_file("clone", "/probe/mailbox/final.wav", target,
                                      64, transcript)
            self.assertEqual(target.read_bytes(), media)
            self.assertEqual(int(target.stat().st_mtime), 1700000000)
            self.assertEqual(os.stat(target).st_mode & 0o777, 0o600)
            self.assertIn(digest, transcript[0])
            with patch.object(clone.subprocess, "run", return_value=SimpleNamespace(returncode=0)), \
                 patch.object(clone, "run", side_effect=["4 1700000000", digest,
                                                       "4 1700000000", digest]), \
                 patch.object(clone, "run_raw", return_value=b"RIF"):
                with self.assertRaisesRegex(clone.CloneError, "tmpfs_copy_mismatch"):
                    clone.copy_tmpfs_file("clone", "/probe/mailbox/final.wav",
                                          Path(folder) / "short.wav", 64, [])
            with patch.object(clone.subprocess, "run", return_value=SimpleNamespace(returncode=1)):
                with self.assertRaisesRegex(clone.CloneError, "tmpfs_file_not_plain"):
                    clone.copy_tmpfs_file("clone", "/probe/mailbox/final.wav",
                                          Path(folder) / "link.wav", 64, [])


if __name__ == "__main__":
    unittest.main()
