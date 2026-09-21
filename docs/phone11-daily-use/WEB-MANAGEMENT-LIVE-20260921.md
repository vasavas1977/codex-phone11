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

- Frontend source: `f386ae58dd04f486cdfa2a5e265998cbe1de89b3`.
- Export API origin: `https://api.phone11.ai`.
- Archive SHA-256: `60a1e652b7a3d5f39ed0edb0a21508c2bc3b9305892f9234d0150794085928a5`.
- Live user URL: `https://1toall.phone11.ai/portal`.
- Live administrator URL: `https://1toall.phone11.ai/admin`.
- Static release tree is sealed root-owned on the existing edge host. The first publication attempt rolled back; the original Nginx bytes, includes, absent current-link and public response were independently verified restored. The independently reviewed retry/re-arm correction then passed prepare and activation. The prior receipt was archived intact; no failure metadata was fabricated for the legacy attempt.

- Publication proved HTTPS root/portal responses, exact public release marker, denial of same-origin API forwarding and credentialed CORS to the existing API origin. Browser checks verified the rendered signed-out portal, navigation to the email/password sign-in page and the administrator sign-in gate. The live portal remains open for the user. No credentials were entered during browser verification.
- Static operator SHA-256: `f13d855d3671fa791b45115d9ed35fff2e1ad267af62698552361cce37bbe24c`; tests: `e458980ef7082be770c516f0eb41c0829b4017b93d6c03d3590416dcddfcf103`. Thirteen focused tests and Python compilation passed; independent final review found no P0–P2 findings.

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
python3 /opt/phone11ai/portal-operator/phone11-static-portal-rollout.py --rollback --manifest /root/phone11-static-portal-f386ae5.json
```

The static operator restores the former site file, legacy includes and prior current-link, then proves their public fingerprints. Marketing and API proxy server blocks are preserved.
