# Phone11 `@all` metadata: guarded migration operator

The routed Team Chat API treats a missing `public.phone11_chat_message_all_mentions`
table as `@all` unavailable. The additive SQL is
`server/chat/all-mentions-live-delta-20260920.sql`, SHA-256
`34a115197fa2accc2e9c35f7656899056e86e68875c05120836d273df2501557`.
This operator only creates that table. It does not change routes, restart an API,
send a notification, or alter SIP or meeting services.

`scripts/phone11-chat-all-mentions-rollout.py inspect --migration <reviewed-sql>`
uses the existing libpq environment (`PGSERVICE` or standard `PGHOST`, `PGPORT`,
`PGDATABASE`, `PGUSER`, and protected credential source). It runs a serializable
read-only transaction. Its output contains only a state and SHA-256 hashes of
database identity and catalog metadata. The catalog fingerprint includes the
message table's OID, owner, grants, columns, and constraints, plus the target
table's metadata if present. No message content or credential is printed.

Before an apply, capture a **fresh** `inspect` result on the intended database.
It must report `state: absent`. Independently confirm the live server identity,
tenant-bound message table, intended Phone11 service owner, and the active API
source. Prepare a private JSON manifest containing exactly:

```json
{
  "schema": "phone11-chat-all-mentions-rollout/v1",
  "migration_sha256": "34a115197fa2accc2e9c35f7656899056e86e68875c05120836d273df2501557",
  "identity_sha256": "<fresh inspect value>",
  "before_catalog_sha256": "<fresh inspect value>"
}
```

The manifest must be a regular mode-0600 file owned by the operator user. Pin
its exact file SHA-256 in the `--manifest-sha256` argument. Create an existing,
private mode-0700 receipt directory owned by the same user. The command is:

```sh
python3 scripts/phone11-chat-all-mentions-rollout.py apply \
  --migration server/chat/all-mentions-live-delta-20260920.sql \
  --manifest /protected/path/all-mentions-pins.json \
  --manifest-sha256 <reviewed-manifest-file-sha256> \
  --receipt-dir /protected/path/all-mentions-receipts
```

`apply` first repeats the read-only preflight. It writes a durable private
`pending` receipt, then checks both pins again in the same serializable database
transaction that executes the pinned SQL. The SQL itself checks the `phone11ai`
owner, `public` schema, prerequisite columns and unique key, grants, and missing
target; it has short lock and statement timeouts. The operator verifies the new
table's columns, constraints, foreign key, primary index, owner, and grants before
commit. After a successful commit it marks the receipt `applied` and records the
post-catalog SHA-256. A second apply fails closed when the receipt exists.

Afterwards, run `inspect` again and require `state: present_valid`; compare the
new catalog SHA-256 with the receipt. Verify `chat.details.canMentionAll` using
an owner/admin test account in its own group or channel, then confirm an ordinary
member cannot send `@all` and that tenant boundaries remain intact. This is
separate from a real push-delivery or handset test.

If the command leaves a `pending` receipt, do **not** retry it automatically:
the database commit may have happened before receipt publication. Run the
read-only `inspect`, preserve the receipt and logs, and reconcile the exact
database and catalog state before any new mutation. There is no automatic `DROP
TABLE` rollback. Once messages can contain `@all`, dropping the table would lose
metadata and damage retry behavior; use a separately reviewed forward fix or
route the API back to a compatible build. If preflight fails before the intent is
written, no database mutation has been attempted.

Validation on 2026-09-25: seven focused Python tests passed. A disposable local
PostgreSQL 17 cluster completed absent → applied → present-valid with the pinned
SQL and a private applied receipt. These are source and disposable-database
checks, not a hosted production migration or device notification acceptance.
