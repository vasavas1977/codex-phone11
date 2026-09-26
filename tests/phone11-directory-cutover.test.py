import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('cutover', Path(__file__).resolve().parents[1] / 'scripts/phone11-directory-cutover.py')
cutover = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cutover)


class FakeEsl:
    def __init__(self):
        self.calls = []
        self.channel_count = '0 total.'
        self.fail_lookup = False
        self.closed = False

    def api(self, command):
        self.calls.append(command)
        if command == 'show channels count': return self.channel_count
        if command == 'module_exists mod_xml_curl': return 'true'
        if command.startswith('user_data '): return '' if self.fail_lookup else 'a' * 32
        return '+OK'

    def close(self): self.closed = True


class CutoverTests(unittest.TestCase):
    def setUp(self):
        self.state = b'old'
        self.esl = FakeEsl()
        self.replacements = []
        self.patches = [
            patch.object(cutover, 'MUTATION_READY', True),
            patch.object(cutover, 'OLD_HASH', cutover.digest(b'old')),
            patch.object(cutover, 'NEW_HASH', cutover.digest(b'new')),
            patch.object(cutover, 'read_file', side_effect=self.read),
            patch.object(cutover, 'inspect', return_value={'State': {'Pid': 100}}),
            patch.object(cutover, 'Esl', return_value=self.esl),
            patch.object(cutover, 'replace', side_effect=self.replace),
        ]
        for p in self.patches: p.start()
        self.addCleanup(lambda: [p.stop() for p in reversed(self.patches)])

    def read(self, path, private=False):
        if path == cutover.TARGET: return self.state
        self.assertTrue(private)
        return b'old' if path.name == 'previous.xml' else b'new'

    def replace(self, value, expected):
        if cutover.digest(self.state) != expected: raise cutover.Refused('active_config_changed')
        self.replacements.append(value)
        self.state = value

    def test_verify_never_reloads_or_changes(self):
        self.assertEqual(cutover.run('verify')['state'], 'ready')
        self.assertEqual(self.replacements, [])
        self.assertNotIn('reloadxml', self.esl.calls)
        self.assertTrue(self.esl.closed)

    def test_known_unsafe_live_module_reload_is_disabled(self):
        with patch.object(cutover, 'MUTATION_READY', False):
            for action in ('apply', 'rollback'):
                with self.assertRaisesRegex(cutover.Refused, 'directory_reload_uncommissioned'):
                    cutover.run(action)
        self.assertEqual(self.replacements, [])
        self.assertEqual(self.esl.calls, [])

    def test_apply_reloads_only_module_and_checks_both_users(self):
        self.assertEqual(cutover.run('apply')['state'], 'applied')
        self.assertEqual(self.replacements, [b'new'])
        self.assertEqual(self.esl.calls.count('reload mod_xml_curl'), 1)
        self.assertEqual(len([c for c in self.esl.calls if c.startswith('user_data ')]), 2)
        self.assertTrue(self.esl.closed)

    def test_directory_failure_restores_previous_config(self):
        self.esl.fail_lookup = True
        with self.assertRaisesRegex(cutover.Refused, 'directory_lookup'): cutover.run('apply')
        self.assertEqual(self.replacements, [b'new', b'old'])
        self.assertEqual(self.esl.calls.count('reload mod_xml_curl'), 2)

    def test_active_calls_and_unknown_config_prevent_mutation(self):
        self.esl.channel_count = '1 total.'
        with self.assertRaisesRegex(cutover.Refused, 'active_calls'): cutover.run('apply')
        self.assertEqual(self.replacements, [])
        self.state = b'other'
        with self.assertRaisesRegex(cutover.Refused, 'active_config_changed'): cutover.run('rollback')
        self.assertEqual(self.replacements, [])

    def test_post_rename_fsync_failure_rolls_back_installed_bytes(self):
        def fail_after_rename(value, expected):
            self.replace(value, expected)
            if value == b'new': raise OSError('synthetic directory fsync failure')
        with patch.object(cutover, 'replace', side_effect=fail_after_rename):
            with self.assertRaises(OSError): cutover.run('apply')
        self.assertEqual(self.state, b'old')
        self.assertEqual(self.replacements, [b'new', b'old'])
        self.assertIn('reload mod_xml_curl', self.esl.calls)

    def test_pre_rename_failure_does_not_overwrite_original(self):
        with patch.object(cutover, 'replace', side_effect=OSError('synthetic temp write failure')):
            with self.assertRaises(OSError): cutover.run('apply')
        self.assertEqual(self.state, b'old')
        self.assertNotIn('reload mod_xml_curl', self.esl.calls)

    def test_rollback_does_not_depend_on_candidate_api_health(self):
        self.state = b'new'
        with patch.object(cutover, 'inspect', return_value={'State': {'Pid': 100}}) as inspect:
            self.assertEqual(cutover.run('rollback')['state'], 'rolled_back')
        self.assertTrue(all(c.args[0] == cutover.FS_ID for c in inspect.call_args_list))
        self.assertEqual(self.replacements, [b'old'])

    def test_reapply_checks_runtime_without_overwriting_same_config(self):
        self.state = b'new'
        self.assertEqual(cutover.run('apply')['state'], 'applied')
        self.assertEqual(self.replacements, [])
        self.assertIn('reload mod_xml_curl', self.esl.calls)


if __name__ == '__main__': unittest.main()
