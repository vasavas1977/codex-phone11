#!/bin/sh
# All local pending-state transitions share a kernel lock. flock releases it
# on process death; no stale lock-file lease can strand a deposit indefinitely.
set -eu

phase=${1:-}
outbox=${PHONE11_VOICEMAIL_OUTBOX:-}
case "$outbox" in /*) ;; *) exit 1 ;; esac
test -d "$outbox" || exit 1

case "$phase" in
  admit|complete|sweep)
    exec /usr/bin/flock -x -w 30 "$outbox/.producer.lock" \
      /usr/local/bin/node /opt/phone11ai/voicemail/producer.mjs "$phase"
    ;;
  reconcile)
    # Reconciliation touches only already-quarantined evidence and the API.
    exec /usr/local/bin/node /opt/phone11ai/voicemail/producer.mjs "$phase"
    ;;
  *) exit 1 ;;
esac
