# Disabled Kamailio wake routing candidate

No active configuration includes these files. No routing, module installation, restart, provider activation or real call was performed. This candidate targets the observed **Kamailio 5.8.4 x86_64** runtime. Parser success alone would not establish SIP transaction, audio, public-number or locked-handset acceptance.

## Exact integration points

The private September 11 pilot-config snapshot contains `PHONE11_INBOUND_PILOT`, `PHONE11_INBOUND_OFFER` and `PHONE11_INBOUND_REPLY`. Its pilot route checks SDP, starts the dialog, sets the origin, rewrites the approved destination, performs `lookup("location")`, then uses the existing offer/media and relay routes. The repository's general `infra/configs/kamailio/kamailio.cfg` has a different extension/Flexisip fallback; `deploy/kamailio` is an older MySQL template. **Do not overwrite the runtime with either template.**

Prepare a private copy of the canonical active config, retaining its exact source/DID authorization, REGISTER authentication, media handling and non-pilot paths. The supplied files are:

- `infra/configs/kamailio/phone11-wake-candidate/modules.inc`: optional HTTP async module settings.
- `infra/configs/kamailio/phone11-wake-candidate/routes.inc`: start, resume, cancellation and terminal routes.
- `ops/scripts/check-phone11-wake-kamailio.mjs`: disposable parser check, using synthetic values and an immutable reviewed image digest.

Only in the reviewed private copy, define `WITH_PHONE11_WAKE_CANDIDATE`, the exact string macros `PHONE11_WAKE_PILOT_URI`, `PHONE11_WAKE_API` (ending `/api/phone11/wake`), `PHONE11_WAKE_SECRET`, and an independently checked unused integer `PHONE11_WAKE_FLAG`. Keep the secret in a private readable-by-Kamailio include. Never place it in a URL, log or source file. Include `modules.inc` after tm/pv and before other libcurl modules, and `routes.inc` after the existing route definitions. Never add a default enabled define.

In `PHONE11_INBOUND_PILOT`, insert this after its approved `$rU`/`$rd` rewrite and before its first location lookup:

```kamailio
#!ifdef WITH_PHONE11_WAKE_CANDIDATE
    route(PHONE11_WAKE_START);
#!endif
```

The candidate consumes only the exact pilot URI and an initial INVITE. It intentionally wakes the enrolled pilot even when an old registrar contact remains; registration presence alone does not prove that iOS can answer. If the gate is disabled, the existing pilot path remains unchanged. This hook does not apply to arbitrary authenticated extension calls, emergency routes, other DIDs, or re-INVITEs.

Inside the existing CANCEL handling, before its normal transaction check/relay, add:

```kamailio
#!ifdef WITH_PHONE11_WAKE_CANDIDATE
    if (t_lookup_cancel("1") && isflagset(PHONE11_WAKE_FLAG)) {
        route(PHONE11_WAKE_CANCEL);
    }
#!endif
```

Keep normal CANCEL processing. In the existing validated in-dialog BYE branch, add `route(PHONE11_WAKE_END)` only when `$dlg_var(phone11_wake) == "1"`, behind the same gate. Preserve the existing BYE media cleanup and relay. The cancellation hook must precede any early exit that would bypass it. The candidate's failure route records a terminal result without adding an unrequested voicemail or alternate carrier route.

## Transaction and backend contract

`POST /offer` uses the original SIP Call-ID and the configured exact pilot URI. JSON values are encoded by `jansson_set`, including quotes/backslashes in a legal Call-ID. The HTTP request has a 28-second timeout beneath the transaction's 30-second initial timer; the backend has its own 25-second readiness budget. `http_async_query` suspends the existing transaction automatically, then continues it in `PHONE11_WAKE_RESUME`; there is no invented RPC or second INVITE. Redirects and verbose HTTP logging are disabled, and HTTPS peer/host verification stays enabled. [Official HTTP async module, 5.8 branch](https://raw.githubusercontent.com/kamailio/kamailio/5.8/src/modules/http_async_client/README).

Resume checks cancellation/expiration and requires a bounded successful JSON `v:1,status:ready` response with a strictly validated server-generated version-4 `callUUID`. It strips caller-supplied `X-Phone11-Wake-ID` headers and appends the validated UUID for exact native wake correlation. It performs a new location lookup and reuses `PHONE11_INBOUND_OFFER`, preserving the original SDP, Call-ID and existing media profile. A failed/expired wake produces a bounded unavailable response. Backend acceptance is not proof of SIP registration or handset audio.

CANCEL is matched to the original INVITE before copying its flag; terminal HTTP requests use non-suspending mode so BYE/CANCEL routing continues. Terminal notices are best effort, with backend setup TTL, durable cancellation tombstones and the device heartbeat providing fallback bounds. The backend must already enforce authenticated pilot enrollment, exact current session/assignment and protected shared-secret ingress. [Official TM cancellation and timer documentation](https://raw.githubusercontent.com/kamailio/kamailio/5.8/src/modules/tm/README), [official TMX transaction documentation](https://raw.githubusercontent.com/kamailio/kamailio/5.8/src/modules/tmx/README), [official JSON encoding documentation](https://raw.githubusercontent.com/kamailio/kamailio/5.8/src/modules/jansson/README).

## Verification and release gates

1. Read-only live inventory confirmed Kamailio 5.8.4 and installed `http_async_client.so`, `jansson.so` and `tm.so`. The observed config already loads tm/tmx, dialog and registrar, but does not load HTTP async. Its dynamic-library resolution and complete candidate parse remain unverified; file presence is not runtime module proof.
2. Run the synthetic parser helper with a reviewed image providing 5.8.4: `node ops/scripts/check-phone11-wake-kamailio.mjs --image registry/repository@sha256:<digest>`. Both gated states must parse. This uses no network and starts no SIP listener. Then privately parse the complete candidate copy with the exact installed binary/module build; never print secret-bearing parse context.
3. In an isolated synthetic SIP harness, prove one held INVITE and one resumed branch; retransmissions produce no duplicate push/branch; cancelled-before-ready never resumes; terminal-first is remembered; backend timeout, invalid JSON, missing registration and busy responses terminate; late HTTP callbacks cannot relay a cancelled/expired transaction. Verify actual CANCEL behavior while suspended and per-transaction AVP/dialog retention. These runtime checks are still required.
4. Independently review the exact candidate diff against the private current config, including unused flag selection, pilot source gate and no overlapping failure hooks. Back up that exact config and prepare exact rollback before any separately authorized reload/restart.
5. Provider/APNs acceptance, physical locked/background registration, incoming Answer, two-way audio, End/BYE and Recents remain separate handset gates. This source candidate does not close them.

Local result: both enabled and disabled synthetic configurations parsed successfully with the official public `ghcr.io/kamailio/kamailio-ci:5.8.4-alpine` image, pinned to `sha256:8eebac744905d360d04bd871ee46a3de0908aa30989649c00fd590914cb35fa0`. The helper checks `kamailio -V` first and runs `-c` with no network, a read-only root filesystem and a disposable runtime directory. Four static guard/header/JSON/terminal tests also passed. This proves 5.8.4 function/config parsing, not the complete production config, SIP transaction behavior or handset ringing. The official project [publishes its images through GHCR](https://www.kamailio.org/wikidocs/install/container/docker/).

Runnable local/Ubuntu CI checks:

```sh
node --test tests/phone11-wake-kamailio.test.mjs
node ops/scripts/check-phone11-wake-kamailio.mjs --image ghcr.io/kamailio/kamailio-ci@sha256:8eebac744905d360d04bd871ee46a3de0908aa30989649c00fd590914cb35fa0
```

The first run may pull this public image; no registry login or live server access is required. The parser helper rejects a mutable image tag and a version other than 5.8.4. No actual addresses, pilot number, subscriber password, push token or shared secret were copied into this document or the candidate.
