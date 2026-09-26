#!/bin/sh
set -eu
/usr/local/bin/node /opt/phone11ai/voicemail/runtime-check.mjs producer >/dev/null
exec /docker-entrypoint.sh "$@"
