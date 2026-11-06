from copy import deepcopy
import unittest

from container_evidence import immutable_container_sha256
from rollback_admission import Refused


ORIGINAL = '1' * 64
REPLACEMENT = '2' * 64


def inspect_row(cid=REPLACEMENT):
    return {
        'Id': cid,
        'Name': '/synthetic-worker',
        'Image': 'sha256:' + 'a' * 64,
        'HostConfig': {'OomKillDisable': False, 'PidsLimit': 32},
        'Config': {'Cmd': ['synthetic-fixture']},
        'Mounts': [
            {'Destination': '/run/fixture', 'Source': '/synthetic/fixture', 'RW': False},
            {'Destination': '/app/fixture', 'Source': '/synthetic/artifact', 'RW': False, 'Type': 'bind'},
        ],
        'State': {'Status': 'created', 'OOMKilled': False},
    }


def fingerprint(row):
    return immutable_container_sha256(row, original_cid=ORIGINAL, replacement_cid=REPLACEMENT)


class ContainerEvidenceTests(unittest.TestCase):
    def test_candidate_false_and_null_forms_match_without_mutating_input(self):
        created = inspect_row()
        exited = deepcopy(created)
        exited['HostConfig']['OomKillDisable'] = None
        exited['Mounts'].reverse()
        exited['State']['Status'] = 'exited'
        self.assertEqual(fingerprint(created), fingerprint(exited))
        self.assertIsNone(exited['HostConfig']['OomKillDisable'])
        self.assertEqual(exited['Mounts'][0]['Destination'], '/app/fixture')

    def test_candidate_missing_true_and_other_values_refuse(self):
        row = inspect_row()
        del row['HostConfig']['OomKillDisable']
        with self.assertRaisesRegex(Refused, 'REPLACEMENT_OOM_KILL_SETTING_MISSING'):
            fingerprint(row)
        for value in (True, 0, 1, 'false', [], {}):
            with self.subTest(value=value):
                row['HostConfig']['OomKillDisable'] = value
                with self.assertRaisesRegex(Refused, 'REPLACEMENT_OOM_KILL_SETTING_FORBIDDEN'):
                    fingerprint(row)

    def test_original_host_config_remains_exact(self):
        original = inspect_row(ORIGINAL)
        changed = deepcopy(original)
        changed['HostConfig']['OomKillDisable'] = None
        self.assertNotEqual(fingerprint(original), fingerprint(changed))
        del changed['HostConfig']['OomKillDisable']
        self.assertNotEqual(fingerprint(original), fingerprint(changed))

    def test_other_host_fields_and_complete_mount_rows_stay_bound(self):
        row = inspect_row()
        mutations = (
            ('HostConfig', 'PidsLimit', 33),
            ('Config', 'Cmd', ['other']),
        )
        for section, key, value in mutations:
            with self.subTest(section=section, key=key):
                changed = deepcopy(row)
                changed[section][key] = value
                self.assertNotEqual(fingerprint(row), fingerprint(changed))
        changed = deepcopy(row)
        changed['Mounts'][1]['Type'] = 'volume'
        self.assertNotEqual(fingerprint(row), fingerprint(changed))

    def test_invalid_duplicate_mount_destinations_and_unowned_identity_refuse(self):
        row = inspect_row()
        row['Mounts'][1]['Destination'] = row['Mounts'][0]['Destination']
        with self.assertRaisesRegex(Refused, 'DUPLICATE_MOUNT_DESTINATION'):
            fingerprint(row)
        for destination in ('', None, 1):
            with self.subTest(destination=destination):
                row['Mounts'][1]['Destination'] = destination
                with self.assertRaisesRegex(Refused, 'INVALID_MOUNT_DESTINATION'):
                    fingerprint(row)
        with self.assertRaisesRegex(Refused, 'UNBOUND_CONTAINER_ID'):
            fingerprint(inspect_row('3' * 64))


if __name__ == '__main__':
    unittest.main()
