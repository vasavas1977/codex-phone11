from dataclasses import replace
from datetime import datetime, timedelta, timezone
import unittest

from rollback_admission import Attempt, Container, Observation, Refused, Sample, evaluate


START = datetime(2026, 11, 6, 1, tzinfo=timezone.utc)


class RollbackAdmissionTests(unittest.TestCase):
    def setUp(self):
        before = START
        stopped = before + timedelta(minutes=5)
        self.old = Container('1' * 64, 'a' * 64, before, stopped, 137)
        self.new = Container('2' * 64, 'b' * 64, stopped + timedelta(seconds=2),
                             stopped + timedelta(seconds=3), 1)
        self.attempt = Attempt(
            original_cid=self.old.cid, original_immutable_sha256=self.old.immutable_sha256,
            original_started_at=before, replacement_cid=self.new.cid,
            replacement_immutable_sha256=self.new.immutable_sha256, journal_sha256='c' * 64,
            retained_original_http_sha256='d' * 64, maintenance_http_sha256='e' * 64,
            prior_http_bytes_match=True, journal_inventory_complete=True,
            old_terminal_confirmations=1, new_start_intents=1, new_ready_confirmations=0,
            new_boot_intents=0, pending_effect='04-one-new-worker-start',
        )
        self.view = Observation(
            original=self.old, replacement=self.new, journal_sha256='c' * 64,
            retained_original_http_sha256='d' * 64, active_http_sha256='e' * 64,
            restart_owner_census_sha256='f' * 64, native_gate_epoch_sha256='0' * 64,
            candidate_exit_matches_single_start_intent=True, active_http_maintenance_verified=True,
            owned_native_fences_verified=True, held_custody_verified=True,
            complete_owner_census_verified=True, candidate_durable_claims_reconciled=True,
            candidate_external_work_reconciled=True, live_original_processes=0,
            live_replacement_processes=0, replacement_restart_owners=0, original_restart_owners=0,
            candidate_boot_artifacts=0, old_address_sessions=0, candidate_address_or_role_sessions=0,
            unknown_effect=None,
        )
        self.first = Sample(stopped + timedelta(seconds=5), self.view)
        self.second = Sample(stopped + timedelta(seconds=7), self.view)
        self.now = stopped + timedelta(seconds=8)

    def from_same_view(self, view):
        return evaluate(self.attempt, replace(self.first, projection=view),
                        replace(self.second, projection=view), self.now)

    def test_known_post_start_failure_preflight_remains_inert(self):
        result = evaluate(self.attempt, self.first, self.second, self.now)
        self.assertEqual(result['status'], 'KNOWN_POST_START_ROLLBACK_PREREQUISITES_MATCH_SOURCE_ONLY')
        self.assertFalse(result['dispatchAllowed'])
        self.assertFalse(result['liveBindingsAccepted'])
        self.assertFalse(result['restoreAdmissionAllowed'])
        self.assertEqual(result['trialSeconds'], 60)

    def test_outcome_unknown_or_candidate_durable_and_external_work_unresolved(self):
        for field, value in (('unknown_effect', 'START_UNKNOWN'),
                             ('candidate_exit_matches_single_start_intent', False),
                             ('candidate_durable_claims_reconciled', False),
                             ('candidate_external_work_reconciled', False)):
            with self.subTest(field=field), self.assertRaises(Refused):
                self.from_same_view(replace(self.view, **{field: value}))

    def test_any_owner_process_boot_artifact_or_session_still_present(self):
        for field in ('live_original_processes', 'live_replacement_processes',
                      'replacement_restart_owners', 'original_restart_owners',
                      'candidate_boot_artifacts', 'old_address_sessions',
                      'candidate_address_or_role_sessions'):
            with self.subTest(field=field), self.assertRaisesRegex(Refused, 'PROCESS_OWNER_BOOT_OR_DATABASE'):
                self.from_same_view(replace(self.view, **{field: 1}))

    def test_exact_container_terminal_state_and_epoch_required(self):
        for changed in (replace(self.new, state='running'), replace(self.new, state='created'),
                        replace(self.new, restart_policy='always'), replace(self.new, restart_count=1),
                        replace(self.new, pid=32), replace(self.new, oom_killed=True),
                        replace(self.new, exit_code=137), replace(self.new, exit_code=0),
                        replace(self.new, immutable_sha256='9' * 64),
                        replace(self.new, started_at=self.old.finished_at - timedelta(seconds=1))):
            with self.subTest(changed=changed), self.assertRaises(Refused):
                self.from_same_view(replace(self.view, replacement=changed))

    def test_partial_repeated_or_boot_started_journal_refuses(self):
        for field, value in (('journal_inventory_complete', False), ('old_terminal_confirmations', 0),
                             ('new_start_intents', 2), ('new_ready_confirmations', 1), ('new_boot_intents', 1),
                             ('pending_effect', None), ('new_start_intents', True)):
            with self.subTest(field=field), self.assertRaisesRegex(Refused, 'WRONG_OR_INCOMPLETE_JOURNAL_BRANCH'):
                evaluate(replace(self.attempt, **{field: value}), self.first, self.second, self.now)

    def test_stale_observation_or_epoch_drift_refuses(self):
        with self.assertRaisesRegex(Refused, 'STALE_OR_UNBRACKETED'):
            evaluate(self.attempt, self.first, self.second, self.now + timedelta(minutes=1))
        changed = replace(self.view, native_gate_epoch_sha256='3' * 64)
        with self.assertRaisesRegex(Refused, 'OBSERVATIONS_DRIFTED'):
            evaluate(self.attempt, self.first, replace(self.second, projection=changed), self.now)

    def test_equal_boolean_and_integer_values_must_still_be_typed_in_both_samples(self):
        for changed, reason in (
            (replace(self.view, active_http_maintenance_verified=1), 'ADMISSION_OR_CUSTODY_UNPROVEN'),
            (replace(self.view, live_original_processes=False), 'PROCESS_OWNER_BOOT_OR_DATABASE'),
            (replace(self.view, replacement=replace(self.new, oom_killed=0)), 'UNPROVEN_TERMINAL_CONTAINER'),
        ):
            with self.subTest(reason=reason):
                self.assertEqual(changed, self.view)
                with self.assertRaisesRegex(Refused, reason):
                    evaluate(self.attempt, replace(self.first, projection=changed), self.second, self.now)
                with self.assertRaisesRegex(Refused, reason):
                    evaluate(self.attempt, self.first, replace(self.second, projection=changed), self.now)

    def test_current_owned_fences_complete_custody_and_exact_http_bytes_required(self):
        for field, value in (('active_http_sha256', '4' * 64), ('journal_sha256', '5' * 64),
                             ('retained_original_http_sha256', '6' * 64),
                             ('owned_native_fences_verified', False), ('active_http_maintenance_verified', False),
                             ('held_custody_verified', False), ('complete_owner_census_verified', False)):
            with self.subTest(field=field), self.assertRaises(Refused):
                self.from_same_view(replace(self.view, **{field: value}))


if __name__ == '__main__':
    unittest.main()
