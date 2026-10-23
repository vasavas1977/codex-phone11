# PBX database and API release — 23 October 2026

The live PBX database migrations and the ordinary admin API's restricted database
cutover are complete. Voicemail delivery is not yet activated. The 60-second
Siprix trial remains; Android and physical-phone testing are deferred.

## Live results

- Applied the reviewed extension-tenant, advanced-routing, phone-number and site
  migrations, including the legacy-default prerequisite. Metadata verification
  found twelve new empty tables and all six expected capabilities. Existing
  processes remained unchanged.
- Retained a fresh pre-DDL backup. An earlier backup was restored into an isolated
  PostgreSQL 16.13 fixture and migrations replayed twice. The fresh pre-DDL dump
  itself has not been restored; the earlier restore excluded ownership and ACLs.
- The ordinary API now connects as `p11_management_runtime_20261023_v1`, role
  OID 26452, over verified TLS. It has explicit grants and no superuser,
  create-database, create-role, inheritance, replication or bypass-RLS rights.
  The role's host rules permit only its two retained API addresses over TLS.
  PostgreSQL rejected wrong-password and plaintext attempts; the client rejected
  the untrusted certificate chain.
- Main `/api/trpc/` traffic moved from localhost port 3023 to 3026 at
  13:27 UTC. Nginx configuration validation and a new worker generation were
  observed; the old API and other protected services remained running.
- The new API has `unless-stopped` restart policy, and Docker is enabled and
  active. No reboot or container restart was performed to test recovery.
- A public anonymous readiness request returned the expected 401. This is not
  signed-in portal acceptance or independent attribution of that public response
  to the new backend. Auth, policy-map and photo routes were unchanged.
- At 14:26 UTC, the two voicemail recording routes also moved from 3013 to
  3026. The directory and local fallback issuer/redemption routes remain on
  3013. The new worker generation was observed, and protected processes remained
  unchanged. Anonymous recording retrieval returned 401; unauthenticated
  admission returned 403. These are denial checks, not successful delivery.

The new image is
`sha256:17b8553fb5ad57b5c766b8396f0dd65bdaea11d8b1593003264a8504578d3d62`;
its installed bundle is
`e1c270e67b1f6d4bc3ed484a74a90c3143cc3b6ddb8db5698208173988c60e5b`.
Its inherited health build identifies the base source, not these three derivative
patches; the reviewed derivative manifest and installed bundle bind the release.

The initial start receipt stopped after Docker normalized `OomKillDisable` from
false to null on this cgroup-v2 host. It remains preserved. A separately reviewed
observation verified the same running process and all other configuration, then
completed the TLS, schema and owner-epoch checks without starting it again.

## Evidence and rollback

Local operational receipts are under
`/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/`:

| Evidence | Receipt |
| --- | --- |
| Live migrations | `PBX-LIVE-MIGRATIONS-20261023-v1.json` |
| Running restricted API and negative authentication | `PBX-VOICEMAIL-BACKEND-RUNNING-20261023-v3.json` |
| Boot policy, unchanged processes | `PBX-COMBINED-API-RESTART-20261023-v1.json` |
| Main tRPC route cutover | `PBX-COMBINED-API-ROUTE-20261023-v1.json` |
| Anonymous public denial | `PBX-COMBINED-PUBLIC-DENIAL-20261023-v1.json` |
| Voicemail route cutover | `PBX-VOICEMAIL-UPLOAD-ROUTE-20261023-v1.json` |
| Voicemail public denial | `PBX-VOICEMAIL-PUBLIC-DENIAL-20261023-v1.json` |
| FreeSWITCH replacement | `PBX-VOICEMAIL-FS-REPLACE-20261023-v2.json` |
| Loaded voicemail XML, modules and artifact closure | `PBX-VOICEMAIL-FS-LOADED-PROOF-20261023-v2.json` |
| Actual FS credential compatibility | `PBX-VOICEMAIL-FS-AUTH-COMPATIBILITY-20261023-v1.json` |
| Consolidated state | `PBX-COMMISSIONING-PROGRESS-20261023-v2.json` |

Native route evidence and retained original configuration are bound by
`/var/lib/phone11-combined-api-route-oct23-v1/99-result.json`, SHA
`5ba65b640ac64e07b2a19d5c0634689a1a32785c632cf5988b5e2d7bf6c2b008`.
The subsequent voicemail route cutover changed the active site SHA to
`97ab043b2776972ad9702a6ab6cec3c31d72684511d4670d4d4d6c2cdfa17148`.
Its native proof is `/var/lib/phone11-voicemail-upload-route-oct23-v1/99-result.json`,
SHA `5547b6c3559c06ed53db026209984984dd0ea053214fef8da67924574e94ad4f`.
The reviewed voicemail rollback restores only its two routes to 3013 and can
operate when 3026 is unhealthy. Main tRPC rollback must account for this newer
configuration instead of using the old site pin. Do not rerun an old cutover
or rollback packet with stale configuration pins. Keep database changes and
backups; do not drop new tables as an application rollback.

## Remaining voicemail boundary

The running combined API passed the owner-epoch admission protocol's absent-tenant
404 check with no admission created. That proves the deployed protocol boundary,
not delivery. The public voicemail upload route now targets this compatible API.
FreeSWITCH was replaced successfully at 15:58 UTC with the corrected immutable
runtime and matching startup manifest. Its original four running profile/transport
pairs remain up, including the private TLS profile. Recording/voicemail volumes
and outbox are unchanged. The new service uses restart `always`; the old container
is retained stopped with restart `no`. The switch observed zero active core,
channel and call counts twice under an owned pause, then used graceful shutdown.
No force kill was requested and other protected service processes were unchanged.

The actual new FreeSWITCH child credential authenticated against the new upload
backend: an absent owner-epoch sentinel returned 404, missing/wrong credentials
returned 403, and read-only checks confirmed no tenant/extension/admission was
created. Seven mounted artifacts and the complete ten-file startup manifest
matched; both loaded voicemail guard structures matched. The public entry is
18th by zero-based index after eighteen earlier extensions, including thirteen
terminal actions, so routing reachability is not established by presence alone.
The completed native XML lookup also confirmed the directory and protected
endpoint/binding configuration, unique scalar parameters and expected repeated
form-field sets. The protected HTTPS binding has its certificate/key/CA fields
present and certificate/hostname verification enabled. Lua, voicemail and
XML-curl modules are loaded. XML configuration observation does not itself prove
a directory request, protected call resolution or TLS negotiation.

Trusted ingress, relay scheduling and matching integrated media/mailbox-delivery
evidence remain outstanding. Global voicemail hooks remain off; no queued audio
was processed. See [voicemail commissioning](VOICEMAIL-DELIVERY-COMMISSIONING-20261023.md).

Legacy services retain their existing database roles. This release restricts the
ordinary admin API; it does not establish whole-stack least privilege or generic
tenant row-level security. No full-production or end-to-end voicemail claim is
made by these receipts.
