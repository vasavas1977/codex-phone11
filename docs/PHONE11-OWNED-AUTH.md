# Phone11-owned sign-in

Status: implemented locally on 2026-09-09; not deployed or installed on a handset.

## Scope

Phone11 email/password sign-in replaces the mobile Manus OAuth dependency. No OAuth
app ID, third-party login redirect, injected session token, or assumed user 1 is used.
This is an authentication change, not completion of the Siprix adapter or PSTN audio
testing. Optional older Forge/Manus AI, storage, and notification helpers elsewhere
in the scaffold are outside this change and are not a prerequisite for this login.

Better Auth 1.7.3 runs in the existing backend and canonical PostgreSQL database.
The application uses its public password hashing/session APIs; passwords are not
implemented with custom crypto. Public signup, password reset, account linking,
and unused session/password mutation routes are closed. Recovery/password change
requires a separately reviewed admin flow; do not promise these controls yet.

## Identity and session boundaries

- New tables are prefixed `phone11_auth_`. Existing users, roles, tenants, extensions,
  SIP credentials, and subscriber records are not recreated or rotated.
- An operator must explicitly link a new auth identity to an existing numeric user
  ID and its unique canonical email. There is no automatic email-based claim.
- Native clients store only the signed session header in SecureStore. Browsers use
  host-only HttpOnly cookies. No bearer token is returned in browser login JSON.
- Native token delivery requires `X-Phone11-Client: native` without browser Origin,
  Referer, or Fetch Metadata headers. CORS does not permit that marker header.
- Every authenticated API lookup validates the database session and identity map.
  Cached profiles cannot authenticate a cold start. Network/503 errors do not erase
  a previously verified in-memory session; a 401 clears it.
- Sign-out explicitly deletes and verifies session revocation before success. This
  guards against Better Auth 1.7.3 swallowing database deletion errors on sign-out.
- SIP credentials are stored in native secure storage and bound to the authenticated
  user. Old plaintext/unowned SIP caches are discarded, not assigned to the next
  user. Logout clears query caches and SIP state. SIP lifecycle cleanup is serialized
  and failed native teardown must be retried before accepting another login.
- The unauthenticated legacy `/ws` server is disabled. Re-enable event delivery only
  after authenticated tenant membership and isolation tests exist. Presence/live
  dashboard events are therefore not delivered through that legacy socket.

## Configuration

Set these through the deployment secret/environment mechanism, never in source:

| Variable | Requirement |
| --- | --- |
| `PHONE11_AUTH_SECRET` | New cryptographically random secret, at least 32 bytes; never reuse `JWT_SECRET`. |
| `PHONE11_AUTH_BASE_URL` | Exact API HTTPS origin, normally `https://api.phone11.ai`. |
| `PHONE11_AUTH_TRUSTED_ORIGINS` | Comma-separated exact approved browser HTTPS origins; no wildcards. API origin is included automatically. |
| `PHONE11_TRUSTED_PROXY_CIDRS` | Exact addresses/CIDRs of the actual reverse proxy. Never trust all forwarded IPs. |
| Existing `PG_*` | The same canonical PostgreSQL database used for PBX provisioning. |
| `EXPO_PUBLIC_API_BASE_URL` | Public API origin in app builds. Contains no credentials. |

HTTP is permitted only for loopback outside production. Do not guess proxy CIDRs:
verify the running proxy topology first. In direct local tests Express trusts no
proxy by default. Rate limits use the verified client address, not supplied headers.

## Operator migration, after approval

1. Verify the exact source revision, canonical database and backup, current users,
   extension ownership, production env file, and trusted proxy addresses. Inventory
   all users affected by retirement of Manus sessions; do not migrate only one user
   and silently strand others. Confirm the new app distribution path first.
2. Build the backend image with the bundled `dist/auth-admin.mjs`. Before switching
   the live backend, run the admin CLI in a one-off container connected to the
   canonical database using the reviewed production environment.
3. Run `node dist/auth-admin.mjs migrate` for a SQL plan only. Review all changes;
   then, with approval, use `node dist/auth-admin.mjs migrate --apply`. It uses a
   transaction and lock timeout, and refuses unsafe/unexpected schema changes.
4. Link each approved canonical identity using `create-identity --apply --user-id
   <verified-id> --email <verified-email> --password-file <private-file>`. Supply the
   chosen password through a temporary owner-only file (mode 600, runtime UID,
   max 512 bytes), not a CLI argument, chat, GitHub artifact, or log. Remove it after
   use. Existing identities/passwords cannot be overwritten by this command.
5. Deploy the exact reviewed image with required configuration. Both build-SHA
   verification and `/api/ready/auth` must pass. `/api/health` alone is liveness,
   not evidence that authentication works. Never auto-run migrations on startup.
6. Install the updated signed iOS build. Old OAuth callback/token-in-URL endpoints
   return 410 and old Manus JWTs are intentionally rejected. Sign in, fetch the
   canonical profile, and re-provision the existing extension. Do not retain the
   old plaintext cached SIP password.
7. Verify actual handset registration, then outbound and inbound PSTN calls with
   two-way audio, answer/hangup state, microphone/route, and foreground/background
   behavior. Correlate device logs, SIP Call-ID and server media evidence. Auth
   tests, API 200s, and ringtone alone do not pass these gates.

Do not roll back to the old insecure session-injection routes as an automatic
fallback. Preserve prefixed auth tables and back up sessions/configuration; an
operational rollback or auth cutover needs explicit owner review.

### Explicit recovery for the observed empty users table

The September 9 production preflight found zero canonical users, while the existing
primary extension 1001 still belongs to user ID 1. The operator-only
`restore-user --apply --confirm-empty-users --user-id <approved-id> --email
<approved-email> --extension <verified-existing-extension>` command can restore
that approved record before identity creation. It locks the relevant tables,
refuses any populated users table or ambiguous/inactive/deleted assignment, creates
only a non-admin user, and advances the existing ID sequence. It never changes SIP
credentials or assignments. There is no public signup or automatic startup recovery.

## Repeatable checks

```sh
pnpm run test:auth
pnpm run test:auth-client
pnpm run test:auth-sip
pnpm run build:backend
pnpm run build:auth-admin
pnpm exec expo export --platform ios --output-dir /tmp/phone11-auth-ios-export
```

The database runner creates a disposable PostgreSQL cluster on a private Unix socket,
with no TCP listener and no production data. It stops and removes the cluster on
normal test completion. Install PostgreSQL server tools locally; use
`PHONE11_TEST_PG_BIN` when `pg_config --bindir` is not suitable. Do not run as root.

For the rendered browser test, start Expo web on port 8089, then run the database
test command with `PHONE11_AUTH_WEB_URL=http://127.0.0.1:8089/auth/sign-in` and an
installed Playwright Chromium. `PHONE11_PLAYWRIGHT_MODULE` can point to a bundled
Playwright package. Auth HTTP calls reach the isolated real database; all non-auth
API calls are explicitly unavailable. Screenshots default to
`/tmp/phone11-auth-browser-check`. This does not test live SIP/PSTN or iOS native code.

The dedicated Owned Auth Checks workflow is PR/manual only, uses no production
secrets, and does not deploy. Existing legacy workflows may deploy on branch pushes:
review them before any push. `build:backend` avoids the existing `prebuild` lifecycle
that otherwise invokes Expo native generation when running `pnpm build`.

## Evidence and remaining gates

Local verification includes real PostgreSQL sign-in, canonical numeric identity,
bad credentials, expiry, rate limiting, exact origins, browser cookie isolation,
durable logout failure/retry, rejected legacy tokens, and disabled identity handling.
Client tests cover loading, timeout, cache, stale-response, logout and failure paths;
SIP tests use native mocks, not a real handset. Browser checks run at 375 and 1440 px.

Backend/admin compilation and iOS JavaScript export do not produce a signed IPA.
Full-repository TypeScript checking still has pre-existing transfer, marketing-site,
and backend type failures. Full Xcode/signing access and the production cutover are
separate gates. Siprix is selected but still requires native integration/build and
physical handset proof. No live user password, SIP password, or production record
was changed during this implementation.

References: [Bearer sessions](https://better-auth.com/docs/plugins/bearer),
[Express integration](https://better-auth.com/docs/integrations/express),
[PostgreSQL](https://better-auth.com/docs/adapters/postgresql),
[Email/password](https://better-auth.com/docs/authentication/email-password).
