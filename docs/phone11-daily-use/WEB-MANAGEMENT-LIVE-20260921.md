# Phone11 management rollout — 21 September 2026

## Scope and evidence

The user/admin web portals and workerless management API are live on the existing Phone11 hosts. This is a bounded management release; unavailable modules and handset gates remain listed below.

- API source: `39523aeb86787450c9d2cf12a430dedb64266de3`.
- Runtime image: `sha256:2e7225e80ec7e5fac5d82c20f294372bbcf325116de9926f7dff5f2a9ee1f1a9`.
- Bundle SHA-256: `152de0d6d2c1fbb743e84227248aa101e044dcb1edb5bc1f347a380b484fc4a5`.
- Lockfile SHA-256: `24a72aa60f0b43fe3afdad41f2e0f0f348f75ac065172627913fe72d43f2c801`.
- Protected API manifest: `/root/phone11-candidate-bluegreen-39523ae.json`, SHA-256 `8102816a3d708823778461fcd10fd7f3c52df78006415e63e983c46c0bf47307`.
- Candidate-only operator inventory, prepare and activation passed. Seven authenticated read-only release probes passed before and after routing, including existing phone/chat, tenant details, self service, unavailable photos, and denied tenant access. No test messages or account mutations were sent.
- Additional public authenticated reads returned HTTP 200: capabilities, tenant details, members, extensions, dashboard and self-service overview. The tested account has admin role. Optional settings report `settingsAvailable: false`.
- Baseline `cp11-backend` remains healthy on image `sha256:d42c70f34d5062bff779c235dd2b6e415bede3b3a86b9de73892acf35b392619`. Calling services were not replaced or restarted. Only tRPC routes moved from port 3002 to 3003; the old candidate remains available for rollback.

## Production schema compatibility

The deployed database has no optional tenant-settings, phone-number, sites, ring-group, queue, IVR or business-hours tables. These modules are explicitly unavailable. Existing identity, memberships and extensions remain usable. No fake zero inventory or successful disabled operations are presented. Multi-workspace administrative mutations require an explicit workspace. No production migrations were performed.

## Static release

- Active frontend source: `076ddac068dd6efbca91a152f75886127a22c0b2`.
- Export API origin: `https://api.phone11.ai`.
- Archive SHA-256: `b3c3b2986f289bb7c2ffcb3d31acfe2ac58ad42b74259a45e002a7787ab4ad37`.
- Export manifest SHA-256: `fc78b9ad1dcb321b49d605121559fe4fa644a06596ce95c6750a88b07aa228f2`.
- Release marker SHA-256: `a3b9d7befcc885493a49a37da2fe46156f3f663aee24ce5fb089fb944eabd40c`.
- Managed activation receipt SHA-256: `136c4109932f60b30fc7ce4198b93439b2e37610d993d86a8cf2ed14d2cc5825`.
- Live user URL: `https://1toall.phone11.ai/portal`.
- Live administrator URL: `https://1toall.phone11.ai/admin`.
- Live recovery URLs: `https://1toall.phone11.ai/auth/sign-in`, `/auth/forgot-password` and `/auth/reset-password`.
- Static release tree is sealed root-owned on the existing edge host. The first publication attempt rolled back; the original Nginx bytes, includes, absent current-link and public response were independently verified restored. The independently reviewed retry/re-arm correction then passed prepare and activation. The prior receipt was archived intact; no failure metadata was fabricated for the legacy attempt.

- Runtime verification of the first recovery export found that the active legacy mobile config omitted both password-recovery capability fields, so the guarded operator restored `f386ae5`. Source `076ddac` adds a strictly bounded compatibility rule: only that complete two-field omission defaults recovery to disabled; partial, malformed and inconsistent capability shapes still fail closed. Its clean-archive export was then published. Sign-in, forgot-password, reset-password, the marker and the main JavaScript asset return HTTP 200 with their exact sealed hashes; same-origin `/api/phone11-static-portal-probe` remains HTTP 404. An independent browser refresh rendered the minimal Sign in page against the live legacy config with editable Email and Password fields, an enabled Sign In control and no unavailable error. No credentials were submitted.
- Static operator SHA-256: `fbde518cf994fe82e3b69e5b363b2308b3ed77c15cd8c84b439b018a2514955d`. Twenty operator tests, 62 focused client tests, Python compilation, TypeScript and diff checks passed. No credentials were entered and no API, PBX or handset runtime was changed by this static publication.

## Validation and limits

Latest API correction: 100 focused backend tests, 11 API operator tests, TypeScript and bundle checks passed. Frontend capability changes: 17 focused tests and TypeScript passed; final static export passed. Independent source reviews found no remaining P0–P2 findings in the API/frontend snapshots. Actual Alpine runtime JPEG/WebP WASM initialization passed during image validation; this does not commission photo service.

Profile photos remain unavailable: their tables, baseline HTTP routes and cleanup worker rollout are not commissioned. No new iPhone build was installed or published; Build 80 is unchanged. No new two-phone calling, push, meeting-media or lifecycle acceptance is claimed. An authenticated browser login and ordinary-user/second-tenant handset acceptance remain separate from the authenticated API probes.

## Rollback

On the VoIP host, as root:

```sh
python3 /opt/phone11ai/web-management-e7270a6/operator/phone11-candidate-bluegreen.py --rollback --manifest /root/phone11-candidate-bluegreen-39523ae.json
```

This restores the prior workerless candidate route and leaves both candidates running. Prior `62b3d9a` receipts were preserved in `/var/lib/phone11-candidate-bluegreen-62b3d9a` after its successful rollback. Do not replace the baseline without satisfying `PROFILE-DND-HOST-ADMISSION-CONTRACT-20260921.md`.

Static rollback on the edge host, as root:

```sh
python3 /opt/phone11ai/portal-operator/076ddac068dd6efbca91a152f75886127a22c0b2/phone11-static-portal-rollout.py --rollback --manifest /root/phone11-static-portal-076ddac.json
```

The managed rollback has passed its non-mutating dry run. It restores the prior `f386ae5` current-link and proves its sealed export plus public fingerprints. The Nginx site and configuration remain unchanged by activation and rollback.
