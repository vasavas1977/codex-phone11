# Meeting admin and tenant-bound join backend candidate

This source-only candidate starts at `9aab1625655c981e16fee8fab0a2e2af9f0fe2e1` and changes only the meeting router/service, channel-meeting start/admin repositories, and their focused tests. It does not include or replace the live backend's later operational overlay. Apply as a reviewed patch against the exact running source; do not redeploy this branch wholesale.

The authenticated `meetings.adminOverview` and `meetings.adminSetHostPermission` routes require active owner/admin membership in the selected tenant. The repository also checks active Phone11 identity, channel and member membership, active assigned extension, and the installed channel-meeting schema. Writes serialize with channel meeting creation using its advisory lock, then take explicit tenant, channel, member, membership, identity, and assignment/extension row locks in that order. The admin role is rechecked after those locks. The default for a missing meeting configuration or storage is unavailable. `meetings.availableForTenant` lists only admissions for the requested configured tenant; optional `tenantId` on `meetings.join` rejects a cross-tenant grant before provider issuance. The old join request remains valid for current mobile clients.

Token issuance now locks the active tenant with `FOR SHARE` before checking channel membership, both when beginning and confirming the short-lived lease. Its admission query keeps that shared tenant mode while retaining exclusive locks on mutable room/member/lease rows. This avoids a member-to-tenant reversal against meeting start and admin edits without serializing independent invitees in one tenant. The issuance transaction also sets a two-second lock timeout inside its three-second statement timeout. PostgreSQL's [row-level lock conflict matrix](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS) shows that tenant `FOR SHARE` is compatible with other joins and conflicts with start's `FOR UPDATE`, while member `FOR KEY SHARE` conflicts with the explicit `FOR UPDATE` used by start and admin edits. The exact running PostgreSQL version must still be checked before deployment.

Local checks on this candidate: focused meeting suites, TypeScript `--noEmit`, and server bundle built with esbuild. These checks use local test doubles and source. They do not prove PostgreSQL concurrency, the hosted schema, running API, Connect11 admission, or mobile/desktop behavior.

Before any production deployment:

1. Pin and inspect the exact running backend source and its narrow overlay. Three-way merge this focused meeting patch into that source. Re-run the same focused tests, TypeScript, and backend bundle on the *merged* candidate. Preserve all unrelated deployed routes and authentication behavior.
2. Run a read-only PostgreSQL schema preflight for `tenants`, `tenant_memberships`, `phone11_auth_identity`, `users`, `user_extensions`, `extensions`, `phone11_chat_conversations`, `phone11_chat_members.can_start_meeting`, `phone11_channel_meetings`, and `phone11_channel_meeting_invitations`. Verify existing migration order, keys, indexes, and member-removal trigger from `channel-meeting-migration.sql`. Do not infer live installation from source files.
3. Review authorization and lock order independently against the merged source and actual PostgreSQL version. A transaction-level concurrency test should race host-permission edits with meeting start and membership removal. Confirm errors fail closed and do not issue provider tokens.
4. Deploy only via the controlled backend release process with a rollback artifact. Smoke-test admin denial for a normal user and another tenant, an authorized channel overview and reversible host-permission edit, tenant-scoped desktop meeting list, and same-tenant join. Confirm the old mobile join path still works. Keep source, deployment, provider, and device evidence separate.

Known limit: the admin overview intentionally refuses workspaces with more than 50 channels or 5,000 eligible members, rather than returning a partial management list. The present candidate offers channel-host permission management, not Zoom's full meeting-policy inheritance, waiting-room administration, recordings, or scheduling.

## Live rollout state — 2026-09-25

The merged release candidate source is `403f95cf43782231b482ee9d0720a704af664862`, with bundle SHA-256 `97770ec21c24ec80f235545ffd66371eb9dd8fd756444578a6af09a5640c2d3b`. The production candidate image `sha256:d23a97bd859bb2788802fe50debc0d5551a1125d3b879d62277016f41fa0bd22` is healthy on loopback `127.0.0.1:3008`. The previous backend on `127.0.0.1:3007` remains healthy and available for route rollback.

The guarded tRPC route switch is active. Its sealed receipt directory is `/var/lib/phone11-meeting-release-route/20260925T023614Z-1e52872e73ec7763`; active Nginx site SHA-256 is `f559523b8963cb7c8b87de301660388af95e2cfb6036c067f0ea6f26fa3cf064`. To restore the predecessor routes, run the operator as root with this receipt:

```sh
sudo python3 /opt/phone11ai/meeting-admin-20260925/route.py rollback --receipt-dir /var/lib/phone11-meeting-release-route/20260925T023614Z-1e52872e73ec7763
```

This invokes the guarded receipt-based route rollback only; it does not stop either backend.

Verification evidence is bounded as follows:

- On the local candidate, 94 meeting tests and 8 provisioning tests passed; TypeScript checking and the server bundle build passed.
- A read-only live schema check against PostgreSQL 16.13 matched the required meeting schema. The local PostgreSQL concurrency test passed, 1/1.
- Anonymous `meetings.availableForTenant` and `meetings.adminOverview` requests returned 401, confirming both routes are recognized and require authentication. An anonymous `POST meetings.join` also returned 401; `GET` returned 405 because join is a recognized mutation. These checks do not prove authenticated authorization or successful meeting admission.
- A read-only tenant-1 query showed both extensions 3001 and 1020 are active, enabled hosts in the shared `Test` channel. Their separate two-member group has host permission off. No host permission was changed during this rollout.
- A later guarded static portal release superseded that older web preview: the signed-in account 3001 can open the Test-channel meeting picker, see 1020 selected by default, and view both Test-channel hosts in Admin → Meetings. This establishes browser rendering and authenticated listing; it does not prove a meeting join or another-tenant denial. See [MEETING-UX-AND-ADMIN-20260925.md](MEETING-UX-AND-ADMIN-20260925.md) for the exact frontend pins and rollback receipt.
- Successful meeting admission and two-device audio remain unproved. The source display-name flag remains off, and bot admission remains unproved.

The checks above do not establish provider acceptance or handset media behavior. Keep the release status at route-active with authenticated join and device acceptance outstanding.
