#!/bin/sh
set -eu
node /opt/phone11ai/voicemail/runtime-check.mjs relay >/dev/null
exec node /opt/phone11ai/voicemail/relay.mjs
