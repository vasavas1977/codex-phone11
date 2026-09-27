# Phone11 extension 1996 SIP consistency release

On 2026-09-27 UTC, extension 1996 could authenticate to Phone11 but its
desktop calling configuration failed to load. The existing subscriber secret
and `sip_accounts` secret did not match. A guarded one-row repair updated only
the tenant 1, user 3, extension 2 SIP account to match the subscriber; no
subscriber password or other extension was changed. The private preimage is
held on the API host at
`/var/lib/phone11-sip1996-repair-20260927/preimage.json` (root-only, mode 0600).
The restore operator is valid only before a successful registration and must
recheck its compare-and-swap guards.

The permanent source fix is commit
`6180658cfcef558a7f198bcd53aa4da68e3d7cd1`. Its API bundle SHA-256 is
`d489be90000d3cdc1c40088c6efb5048d65d44db6a3084ffebb9461ac87f682c`.
The guarded release overlays that bundle on the pinned predecessor image and
runs it as `cp11-api-candidate-sip-consistency` on loopback port 3016. Public
`/api/trpc` traffic was switched from 3015 to 3016 using release operator
commit `3046d103379d36f9f1a9a9337fa69b0ae730fe44`. The site file SHA-256
after activation is
`aa31a27c3d65a0167fb3f8d2aca08b059f86cbec824c0777e73b278169737485`.
The 3015 predecessor remains running and healthy as a rollback target.

Validation actually completed: 81 focused source tests, typecheck, isolated
PostgreSQL create/reset/rollback and cross-tenant cases, 13 release-operator
tests, staged authenticated `phone.getConfig` HTTP 200 for extension 1996,
public authenticated `https://api.phone11.ai/api/trpc/phone.getConfig` HTTP 200
for the same extension, and public unauthenticated HTTP 401. The API and
fallback container health endpoints returned HTTP 200 after activation.
Only boolean/status results were printed from authenticated checks; SIP
credentials and session tokens were not logged or saved.

The desktop application still needs a fresh user sign-in to verify that it
reaches the dialer and registers SIP; the stale pre-repair error remains on
its sign-in screen until then. The current `main` branch is older than this
release source, so the fix is being ported separately before it can be merged.

If the new API regresses before a subsequent release changes the pinned
state, use the reviewed operator with its pinned manifest to roll the two
tRPC locations back to 3015:

```sh
sudo python3 /var/lib/phone11-sip-consistency-release-20260927/operator/scripts/phone11-sip-consistency-release.py rollback \
  --manifest /var/lib/phone11-sip-consistency-release-20260927/inputs/manifest.json
```

The operator refuses drift in the predecessor, candidate, manifest, and site
file. Investigate a refusal before making any manual proxy or credential
change.
