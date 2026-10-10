# PBX business hours and holiday editor

This source change closes a destructive-edit gap: the previous admin editor
replaced every saved rule with one Monday–Friday interval. The editor now
round-trips multiple weekday intervals, holiday closures and optional date
windows through the existing admin APIs. Unsupported weekdays, time precision
or unfamiliar future fields disable saving instead of silently discarding rules.
This editor still supports Monday–Friday schedules; custom weekday selection,
overnight hours and separate holiday destinations are not implemented here.

Zoom separates business, closed, break and holiday call handling, with an
explicit timezone ([call queue settings](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0065370)).
Phone11 uses multiple open intervals to represent breaks and full-day holiday
ranges to use the existing closed destination. This is a supported subset,
not complete Zoom Phone parity.

The runtime evaluator now derives the weekday, date and time directly in the
saved IANA timezone. It no longer reparses localized wall time as a server-local
instant or converts that calendar date to UTC. PostgreSQL DATE columns are
projected with explicit `YYYY-MM-DD` formatting in both evaluation and admin GET,
so PostgreSQL DateStyle and Node's DATE parser cannot shift or reformat dates.
Regular rules now honor inclusive date windows; holiday closures retain priority
and existing minute-inclusive closing-time behavior is preserved.

Validation on 1 October: 64 focused tests passed, including three actual
loopback PostgreSQL 17 cases using ISO/MDY, SQL/MDY and German/DMY DateStyle.
The eight evaluator fixtures also passed with the process timezone set to
America/Los_Angeles. TypeScript and the backend bundle passed. These tests prove
source behavior and isolated database contracts, not deployed SIP routing.
The repository test command passed 2,361 Vitest cases (450 environment-gated
skips) and 69 Node cases. Focused lint, workflow YAML parsing and diff checks
passed. Independent source review approved the exact evaluator, admin GET,
PostgreSQL test and CI definition; it did not attest live routing.

## Live evidence boundary

A credential-free read-only inventory at 03:10 UTC confirmed the existing
FreeSWITCH and backend containers remain running on their prior image IDs.
FreeSWITCH has its persistent voicemail volume and private outbox binds;
the voicemail volume still contains zero files. Backend candidates have a
configured voicemail path and persistent `/var/lib/phone11` bind. No recordings
were read, no hook was enabled, and no production database or public route was
changed. Mount existence does not prove successful deposits, relay delivery or
owner-authorized playback.

The latest signed pilot remains Build 111. On this audit both test iPhones were
unavailable to devicectl and iPhone Mirroring required the user's Mac login.
The existing Chrome Phone11 portal was signed out. Installation, authenticated
candidate acceptance, live voicemail deposit/playback, meeting audio and locked
screen ringing remain separate pending checks.
