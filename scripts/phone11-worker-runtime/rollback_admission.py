"""Source-only preflight for the known candidate-exited-before-readiness case.

Trusted, held host observations are a separate prerequisite. This module accepts
no command-line input and provides no transport, signals, start or release actions.
"""

from dataclasses import dataclass
from datetime import datetime
import re


class Refused(RuntimeError):
    pass


def require(condition, code):
    if not condition:
        raise Refused(code)


@dataclass(frozen=True)
class Container:
    cid: str
    immutable_sha256: str
    started_at: datetime
    finished_at: datetime
    exit_code: int
    state: str = 'exited'
    pid: int = 0
    restart_policy: str = 'no'
    restart_count: int = 0
    oom_killed: bool = False


@dataclass(frozen=True)
class Attempt:
    original_cid: str
    original_immutable_sha256: str
    original_started_at: datetime
    replacement_cid: str
    replacement_immutable_sha256: str
    journal_sha256: str
    retained_original_http_sha256: str
    maintenance_http_sha256: str
    prior_http_bytes_match: bool
    journal_inventory_complete: bool
    old_terminal_confirmations: int
    new_start_intents: int
    new_ready_confirmations: int
    new_boot_intents: int
    pending_effect: str | None


@dataclass(frozen=True)
class Observation:
    # All data except observed_at must agree between independently read samples.
    original: Container
    replacement: Container
    journal_sha256: str
    retained_original_http_sha256: str
    active_http_sha256: str
    restart_owner_census_sha256: str
    native_gate_epoch_sha256: str
    candidate_exit_matches_single_start_intent: bool
    active_http_maintenance_verified: bool
    owned_native_fences_verified: bool
    held_custody_verified: bool
    complete_owner_census_verified: bool
    candidate_durable_claims_reconciled: bool
    candidate_external_work_reconciled: bool
    live_original_processes: int
    live_replacement_processes: int
    replacement_restart_owners: int
    original_restart_owners: int
    candidate_boot_artifacts: int
    old_address_sessions: int
    candidate_address_or_role_sessions: int
    unknown_effect: str | None


@dataclass(frozen=True)
class Sample:
    observed_at: datetime
    projection: Observation


def require_aware(value):
    require(isinstance(value, datetime) and value.utcoffset() is not None, 'TIMESTAMP_NOT_AWARE')


def require_hash(value):
    require(type(value) is str and re.fullmatch(r'[0-9a-f]{64}', value) is not None, 'INVALID_EXACT_BINDING')


def terminal(frame):
    require_aware(frame.started_at)
    require_aware(frame.finished_at)
    require(frame.state == 'exited' and type(frame.pid) is int and frame.pid == 0
            and frame.restart_policy == 'no' and type(frame.restart_count) is int
            and frame.restart_count == 0 and frame.oom_killed is False
            and frame.started_at < frame.finished_at, 'UNPROVEN_TERMINAL_CONTAINER')


def validate_observation(attempt, view, first_observed_at):
    for digest in (view.restart_owner_census_sha256, view.native_gate_epoch_sha256):
        require_hash(digest)
    require(view.journal_sha256 == attempt.journal_sha256
            and view.retained_original_http_sha256 == attempt.retained_original_http_sha256
            and view.active_http_sha256 == attempt.maintenance_http_sha256, 'JOURNAL_OR_HTTP_BINDING_DRIFT')
    require(view.unknown_effect is None and view.candidate_exit_matches_single_start_intent is True,
            'CANDIDATE_START_OUTCOME_UNRECONCILED')
    require(view.active_http_maintenance_verified is True and view.owned_native_fences_verified is True
            and view.held_custody_verified is True, 'ADMISSION_OR_CUSTODY_UNPROVEN')
    require(view.complete_owner_census_verified is True, 'RESTART_OWNER_CLOSURE_UNPROVEN')
    require(view.candidate_durable_claims_reconciled is True and view.candidate_external_work_reconciled is True,
            'CANDIDATE_DURABLE_OR_EXTERNAL_WORK_UNRECONCILED')
    blockers = (view.live_original_processes, view.live_replacement_processes,
                view.original_restart_owners, view.replacement_restart_owners,
                view.candidate_boot_artifacts, view.old_address_sessions, view.candidate_address_or_role_sessions)
    require(all(type(count) is int and count == 0 for count in blockers), 'PROCESS_OWNER_BOOT_OR_DATABASE_STILL_PRESENT')
    old, new = view.original, view.replacement
    terminal(old)
    terminal(new)
    require(old.cid == attempt.original_cid and old.immutable_sha256 == attempt.original_immutable_sha256
            and old.started_at == attempt.original_started_at and type(old.exit_code) is int
            and old.exit_code == 137, 'ORIGINAL_TERMINAL_OUTCOME_MISMATCH')
    require(new.cid == attempt.replacement_cid and new.immutable_sha256 == attempt.replacement_immutable_sha256
            and old.finished_at <= new.started_at and new.finished_at <= first_observed_at
            and type(new.exit_code) is int and 1 <= new.exit_code <= 125, 'REPLACEMENT_NOT_KNOWN_FAILED_START')


def evaluate(attempt, first, second, now):
    """Validate a narrow post-start rollback prerequisite, never grant authority."""
    for timestamp in (first.observed_at, second.observed_at, now, attempt.original_started_at):
        require_aware(timestamp)
    require(1 <= (second.observed_at - first.observed_at).total_seconds() <= 10
            and 0 <= (now - second.observed_at).total_seconds() <= 10, 'STALE_OR_UNBRACKETED_OBSERVATION')
    for digest in (attempt.original_cid, attempt.original_immutable_sha256,
                   attempt.replacement_cid, attempt.replacement_immutable_sha256,
                   attempt.journal_sha256, attempt.retained_original_http_sha256,
                   attempt.maintenance_http_sha256):
        require_hash(digest)
    require(attempt.original_cid != attempt.replacement_cid, 'ORIGINAL_AND_REPLACEMENT_ALIAS')
    require(attempt.maintenance_http_sha256 != attempt.retained_original_http_sha256
            and attempt.prior_http_bytes_match is True, 'ORIGINAL_HTTP_BYTES_UNPROVEN')
    journal_counts = (attempt.old_terminal_confirmations, attempt.new_start_intents,
                      attempt.new_ready_confirmations, attempt.new_boot_intents)
    require(attempt.journal_inventory_complete is True and all(type(n) is int for n in journal_counts)
            and journal_counts == (1, 1, 0, 0)
            and attempt.pending_effect == '04-one-new-worker-start', 'WRONG_OR_INCOMPLETE_JOURNAL_BRANCH')
    require(first.projection == second.projection, 'OBSERVATIONS_DRIFTED')
    # Dataclass equality treats false as zero and true as one. Both samples
    # must independently satisfy the exact types in the admission predicates.
    validate_observation(attempt, first.projection, first.observed_at)
    validate_observation(attempt, second.projection, first.observed_at)
    return {'status': 'KNOWN_POST_START_ROLLBACK_PREREQUISITES_MATCH_SOURCE_ONLY',
            'dispatchAllowed': False, 'liveBindingsAccepted': False,
            'restoreAdmissionAllowed': False, 'trialSeconds': 60}
