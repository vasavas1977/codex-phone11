# PBX primary-key visibility for read-only logins — 7 October 2026

The advanced primary-key preflight used privilege-filtered `information_schema`
views. A real SELECT-only login could see the complete routing columns but no
primary-key metadata, incorrectly reporting nine `:primary_key` failures.

The preflight now reads schema-bound `pg_catalog` constraints and backing indexes,
resolves column names in constraint order and requires a validated, immediate,
nondeferrable primary key with a live, ready, valid unique index and the exact
key shape. Missing, wrong-column, reordered, included-column and deferrable keys
remain incompatible; a same-named table in another schema cannot supply the key.
The existing repeatable-read read-only transaction and all other gates remain.
The synthetic local writer harness now expects compatible reader preflight.
Read-only compatibility grants no INSERT, DDL or release authority.

A fresh PostgreSQL 17.11 cluster accepted only a private Unix socket. Its real
SCRAM-authenticated reader was a separate NOSUPERUSER/NOBYPASSRLS/NOCREATEROLE/
NOCREATEDB login with schema USAGE and table SELECT only. The original query
reproduced all nine false failures. The corrected focused suite passed **130
cases without skips**, including exact transaction mode, reader INSERT/DDL
denial and unchanged catalog readback for every malformed key. The owned cluster
was stopped and temporary data removed. Scoped TypeScript, ESLint and whitespace
checks passed. The disposable local harness was not rerun in full; no hosted or
broad repository suite was repeated.

The unsigned voicemail bundle remains pinned to source
`e714d6488045ccfea8df10c8bf8592f1d9a781b9` and manifest SHA256
`2726c2fcf0b8a307aa4e0691d76015b7dc3d9da6a1fa4a5847438982053d27a7`.
This later preflight change does not relabel that package. Neither result supplies
current target writer/role inventory, active/rollback custody, protected-clone
rehearsal, migration definitions, helper/Lua readiness, durable storage,
deposit/playback acceptance or action-time operational authority. No production
connection, role grant, migration, deployment, routing, flag or signing occurred.
