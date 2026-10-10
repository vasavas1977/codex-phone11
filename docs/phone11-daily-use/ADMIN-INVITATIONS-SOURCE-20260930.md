# Phone11 workspace invitations

Source state: invitation and acceptance flow is integrated into the current admin
and auth architecture. Invitations remain off unless the runtime toggle, trusted
origin, verified sender, provider credentials, and schema readiness all agree.
No production migration, provider email, or deployment was performed.

The People page keeps existing membership editing and shows a separate invitation
panel only after a fresh capability check for the selected workspace. An owner or
administrator can invite a member; only an owner can invite or revoke an administrator.
The server rechecks live tenant authority for every operation. Invitation tokens
are random, stored only as SHA-256 digests, expire after 48 hours, rotate on
resend, and are consumed in the same transaction that creates the membership.
The public acceptance route reads the token from the URL fragment and clears the
browser URL. Existing accounts must sign in as the invited identity. New accounts
receive a canonical user, Phone11 auth identity, and membership atomically.
Invitations do not assign an extension or change an existing membership. Accounts
with an active membership in another workspace cannot accept one.

The two SQL files are review artifacts and are never run by app startup. Phase 1,
`server/invitations/migration-users-index.sql`, builds the canonical-email
unique index concurrently with a 15-minute statement bound and a 5-second lock
bound. Run it with `psql -X -v ON_ERROR_STOP=1 -f`, without `--single-transaction`.
Phase 2, `server/invitations/migration.sql`, validates the exact, ready index
and creates the new invitation tables in a bounded transaction. Keep the feature
off until both phases and schema readiness checks pass. Local PostgreSQL tests
run both files only inside a disposable database.

If phase 1 fails, inspect `pg_index.indisvalid` and `indisready` for
`phone11_users_normalized_email_unique` and resolve duplicate emails or lock
contention. A failed concurrent build can leave an invalid index; after review
and with invitations still off, remove only that invalid index with
`DROP INDEX CONCURRENTLY phone11_users_normalized_email_unique;`, then retry
phase 1. Do not drop a valid index. If
phase 2 fails, its transaction rolls back while the valid phase-1 index remains;
fix the cause and retry phase 2 directly. Provider acceptance is shown in the
UI as provider acceptance, not recipient delivery.

Local checks: invitation/auth PostgreSQL suite 92 passed, 1 skipped (the existing
browser test requires a live web URL); focused HTTP, mailer, rate, admin UI, and
auth client suites passed; full TypeScript check, backend bundle, and focused ESLint
passed after installing the desktop app dependencies locally. A clean web export succeeded after clearing
Metro state and includes `/auth/accept-invitation` and `/admin/users`. That is
build output, not browser or live acceptance.

Next gates: review the SQL against a backed-up clone and current production
schema, confirm the release source and secrets, then obtain action-time authority
before migration, activation, provider send, or live recipient acceptance.
