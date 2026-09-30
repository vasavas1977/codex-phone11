#!/bin/sh
# Serialize all local admission, completion, inspection, and retirement steps.
# The kernel releases flock on process death; no stale lease can strand calls.
set -eu

phase=${1:-}
outbox=${PHONE11_VOICEMAIL_OUTBOX:-}
case "$outbox" in /*) ;; *) exit 1 ;; esac
test -d "$outbox" || exit 1

case "$phase" in
  admit|complete|inspect|retire)
    exec /usr/bin/flock -x -w 30 "$outbox/.producer.lock" \
      /usr/local/bin/node /opt/phone11ai/voicemail/producer.mjs "$phase"
    ;;
  *) exit 1 ;;
esac
