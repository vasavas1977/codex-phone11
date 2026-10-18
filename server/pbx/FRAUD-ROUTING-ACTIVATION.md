# Fraud routing activation proposal

Status: production activation remains blocked, 18 October 2026, Bangkok. No
production routing configuration has been activated or qualified. Owner policy is domestic on,
international and premium off until explicitly enabled. Preserve established
internal, emergency, domestic, DID, media and recording behavior.

## Protected handler source foundation

The mounted backend now intercepts the exact `phone11_protected_outbound`
context, and malformed supplied contexts, before every legacy branch. Its
production entry is deliberately **UNBOUND** and returns constant terminal
`CALL_REJECTED` XML. Stored policy flags, environment variables and service
authentication cannot enable it. This closes backend fallthrough for that
decoded context; it does not close a global-parser ambiguity, another context,
a direct-SBC path or an installed configuration bypass.

The separately testable core accepts strict raw form input, canonical
authenticated user/realm plus commissioned peer/profile/direction, and a
generated injected assignment resolver. It uses the dedicated fixed-tenant
policy transaction and waits for commit before returning exact-context XML.
The dial scanner is linear; ordinary or unsupported Thai targets are rejected,
except the explicitly classified Thai 1900 premium forms. No production
assignment resolver or qualified ingress factory exists yet. The existing
policy LOGIN has no new SIP-table grants or shared-pool fallback.

Independent source review passed 351 focused tests, scoped and full strict
TypeScript, and the backend build. The exact source packet is
`trusted-routing-binding-implementation-v3/MANIFEST.json`, SHA256
`35e1a0edfe5e6b8728ce51e5542b73185c7036e3776c3c839023756f62113b27`,
in the operator commissioning batch. This is source evidence, not live identity,
relay, gateway or carrier acceptance.

The latest generated exact-image native routing matrix passed **25/25** cases.
Its receipt is `ROUTING-NATIVE-LAB-ACTUAL-v13.json`, SHA256
`88b727fc13faaa0ee9d899f4587fa9be6c50e11a70fd12a5a6cefe2fa011db41`.
Every case retained its original route/bridge/hangup criteria, a 2.75-second
deadline and a final zero channel count before the next call. Generated caller
and sink lifetimes are controlled; malformed response fixtures are explicitly
rejected. The four SQL-count reads now span 0/100/200/300 ms to account for the
reference implementation's asynchronous channel-table updates. This does not
establish the sole cause of an earlier failure or an exact source-build match.
Owned helpers, client and container were removed successfully.

Historical full matrices with 19 passes/six failures, and the subsequent run
that stopped at P06 after five completed cases, remain preserved as failures.
The partial run retained no individual pass results. Neither was relabelled by
the later success. The current matrix still uses a generated transport stub,
not the real policy endpoint or relay; its XML fixtures differ from the relay's
stricter response schema. Trusted identity, real relay, policy LOGIN, gateway,
carrier and production activation remain separate gates.

## Observed source paths and bypasses

| Path | Source evidence | Activation implication |
| --- | --- | --- |
| Dynamic callback | `server/pbx/freeswitch-routes.ts:187-232` uses the dedicated `withFraudPolicyTransaction` reader for protected destinations; `:456-463` derives tenant from one active SIP account/extension assignment. | One exact tenant row with both boolean flags is required. Thai local/canonical 1900 needs premium; international premium needs both. Missing binding, malformed policy and transaction errors deny before bridge XML. Telephony reads do not invoke an admin actor helper. |
| Compose FreeSWITCH | `infra/compose/docker-compose.prod.yml:99` mounts `infra/configs/freeswitch`; `autoload_configs/xml_curl.conf.xml:23-41` inside that tree comments out the dialplan binding. | Mounting the backend or commissioning the database does not put calls through its guard. |
| Local XML | `infra/configs/freeswitch/dialplan/public/02_kamailio_outbound.xml:41-70` transfers international/general numbers to default; `dialplan/default/01_1toall_outbound.xml:36-59` bridges broad numeric and plus-prefixed destinations directly. `dialplan/default.xml:794` includes additional rules, including `default/01_example.com.xml:17-26` generic/international bridges. | A callback miss/failure must never reach one of these unguarded bridges. Inspect all included rules and transfer targets, not just the named carrier file. |
| Infra Kamailio | `infra/configs/kamailio/kamailio.cfg:421-429` sends authenticated local-origin PSTN to FreeSWITCH; `:494-502` selects a dispatcher destination or fallback FS address. | Every selected/failover FS must have equivalent guard and fallback configuration. Inbound DID routing is a separate path. |
| Separate deploy stack | `deploy/kamailio/kamailio.cfg:221-225,351-359` sends matching external numbers directly to the SBC. `deploy/freeswitch/dialplan/cloudphone11.xml:139-151` bridges PSTN back through Kamailio; `deploy/freeswitch/docker-compose.yml:44-46` mounts that local tree. | Enabling XML-curl in the infra tree cannot protect this alternative direct-SBC route. It also risks a routing loop if a new protected FS path bridges back into the same unqualified Kamailio branch. |

These are checked-in alternatives, not proof of which configuration is active.
The API's capability or successful save/readback is not routing enforcement.

### Read-only target observation, 17 October 2026

The owner-selected EC2 instance was running. A filtered Docker metadata read
found running `p11-freeswitch`, `p11-kamailio`, `cp11-backend`, `cp11-postgres`
and `p11-rtpengine` containers. FreeSWITCH and Kamailio mount the respective
directories under `/opt/phone11ai/cloudphone11/infra/configs`. This identifies
mounted host paths; it does not establish loaded configuration or public route
ownership. No service, configuration, database or routing change was made.

A bounded no-follow fingerprint read matched five source files: FreeSWITCH's
main configuration, module list, public outbound handoff, local carrier rules
and example rules. The mounted `freeswitch/dialplan/default.xml` and
`kamailio/kamailio.cfg` differed from this checkout. The mounted XML-curl file
was unreadable by the current SSH user; the read did not elevate access or
export file contents. Do not overwrite these files from the source tree or
assume the commented source XML-curl binding reflects the live file. The
matching local carrier catch-all still requires the fallback review above.

The finite observation and exact hashes are retained in the operator packet
`review/pbx-api-integration-20261017-v1/` as
`DOCKER-PBX-TOPOLOGY-RESULT-v2.json` and
`PBX-MOUNTED-CONFIG-FINGERPRINT-RESULT.json`. Unknown prior sidecar state remains
preserved; no cleanup or adoption followed this observation.

A subsequent independently reviewed, single-file read used the server's
existing noninteractive sudo authorization. It changed no permissions and
exported no configuration values. The protected XML-curl file also differs
from the checkout. Its bounded XML classification found one directory binding
and no declared dialplan binding. This closes the earlier read-access gap for
that fingerprint/classification only; it does not prove loaded modules, the
directory endpoint's effective authentication or any active call route. The
finite result is `PBX-XMLCURL-ROOT-FINGERPRINT-RESULT.json` in the same packet.
The final file comparison is five matches and three differences; preserve the
deployed directory configuration and review the differences before activation.

## Preferred change: guarded FreeSWITCH callback with safe local fallback

1. Select the actual deployed tree, authenticated outbound entry context and
   all failover nodes. Prepare one reviewed candidate covering the complete
   path to the carrier; keep carrier ingress/DID contexts separated. Capture
   canonical authenticated user/realm immediately after successful subscriber
   authentication in Kamailio, stripping client-supplied copies before injection.
   Commission exclusive authenticated Kamailio ingress, the observed FreeSWITCH
   peer/profile/direction, registry-to-SIP-account mapping and carrier presentation.
   Neither From/domain/caller ID, a naked custom header nor the FreeSWITCH HTTP
   service secret establishes subscriber authority. Do not enable the new core
   until these bindings and the strict raw callback boundary are qualified.
2. **Harden local fallback first.** In every reachable outbound context, retain
   the existing emergency/internal paths and explicitly supported domestic
   mobile/landline routes. Replace protected numeric/plus catch-all bridges
   with terminal denial (`hangup CALL_REJECTED`, no `continue` or transfer to
   another PSTN context). Unknown/unsupported numeric forms must deny too.
   Domestic acceptance must use a reviewed positive classification equivalent
   to `server/pbx/e164.ts`, excluding premium and international-access prefixes;
   broad `0`/`66`/digit-length rules are insufficient. Cover local and canonical
   Thai 1900, `+`/`00` international, bare carrier formats and transfer targets.
   Audit default/example includes and alternate gateway bridges as well.
3. Enable the protected callback only after fallback-denial rehearsal and the
   compatibility review below. Upstream XML-curl has no verified arbitrary
   request-header setting for `x-fs-secret`; the backend remains header-only.
   Prepare a separately reviewed authenticated fixed local/private proxy that
   injects that header for one fixed backend route, or a version-bound module
   patch. Native HTTP credentials/mTLS may authenticate FS to that proxy; they
   do not become the backend header automatically. Disable arbitrary upstreams
   and redirects, protect secrets and verify TLS. Neither option is implemented
   or authorized here. Include destination, caller username, caller domain and
   context explicitly; the commented binding omits `variable_domain_name`.
4. Prefer routing only protected outbound calls through a dedicated guarded
   context, leaving established emergency/internal/domestic routes local.
   Before doing this, qualify the callback's returned context and destination
   matching on the installed FreeSWITCH version: it currently emits `default`
   XML and bridges `pstn_gateway`, while local carrier rules use
   `1toall-outbound`. Prepare a focused context/gateway adaptation if required;
   do not change gateway names, caller ID, codecs, NAT or recording implicitly.
5. Remove the selected topology's direct protected SBC branch or restrict it
   to the validated guarded FS egress, with no client/carrier ingress bypass.
   If the separate deploy stack is active, apply this change there explicitly;
   changing the infra compose tree alone is insufficient.

Do not infer XML-curl failure semantics from handler tests. Rehearse timeout,
HTTP 403/503, TLS/DNS/network failure, empty/not-found/malformed XML and module
unavailability on the exact FS build. Each must terminate protected routing
without trying a local/general/default/example/SBC bridge. A denial must be a
terminal matched rule; empty XML alone is not an adequate fallback policy.

## Upstream compatibility findings, checked 17 October 2026

- **Header support:** upstream `mod_xml_curl.c` `do_config()` accepts
  `gateway-credentials`/`auth-scheme`, TLS settings and POST-variable filters,
  but no arbitrary HTTP-header parameter. `xml_url_fetch()` constructs fixed
  content-type/Expect headers; credentials use libcurl HTTP authentication.
  Checked [v1.10.12, configuration parser](https://github.com/signalwire/freeswitch/blob/v1.10.12/src/mod/xml_int/mod_xml_curl/mod_xml_curl.c#L361-L439)
  and [current master, request construction](https://github.com/signalwire/freeswitch/blob/master/src/mod/xml_int/mod_xml_curl/mod_xml_curl.c#L203-L235).
  `enable-post-var` filters body fields, not request headers; `mod_curl`
  [`append_headers`](https://developer.signalwire.com/freeswitch/module-reference/applications/mod_curl/)
  belongs to a different module. No config-only direct
  `x-fs-secret` mechanism was verified for these versions.
- **Fallback is real:** `xml_url_fetch()` returns NULL for non-200/oversized
  responses or parsing failure ([v1.10.12](https://github.com/signalwire/freeswitch/blob/v1.10.12/src/mod/xml_int/mod_xml_curl/mod_xml_curl.c#L274-L318)).
  Core `switch_xml_locate()` tries bindings, skips result/not-found responses,
  then uses `switch_xml_root()` when no usable section remains; missing sections
  also re-enter that local-root lookup ([v1.10.12 core](https://github.com/signalwire/freeswitch/blob/v1.10.12/src/switch_xml.c#L1650-L1724),
  [current master core](https://github.com/signalwire/freeswitch/blob/master/src/switch_xml.c#L1686-L1760)).
  This conflicts with the current [official XML-curl manual](https://developer.signalwire.com/freeswitch/integration/xml-curl/)
  statement that bound sections never consult static files. Use the concrete
  source behavior as the design baseline; verify the actual binary separately.
- **Context/gateway contract:** `dialplan_hunt()` selects the caller profile
  context, then `global`; it does not substitute `default` when a different
  context is requested ([v1.10.12 dialplan](https://github.com/signalwire/freeswitch/blob/v1.10.12/src/mod/dialplans/mod_dialplan_xml/mod_dialplan_xml.c#L592-L625)).
  A dedicated guarded context therefore needs a fixed, reviewed matching
  response context. The current handler output named `default` cannot simply
  be activated there. `sofia/gateway/<name>/<number>` references a configured
  gateway by name ([official gateway manual](https://developer.signalwire.com/freeswitch/users-and-endpoints/gateways/));
  `pstn_gateway` and `1toall-outbound` require an explicit qualified mapping.

These are upstream v1.10.12/current-master findings, not evidence of the
installed build, downstream patches, loaded module or effective configuration.
The subsequent protected XML-curl fingerprint/classification resolved the
earlier read-access gap only; Kamailio/default XML differ from source, and loaded
runtime behavior remains unqualified. Do not implement a module patch/proxy or
activate routes from these findings alone.

### Protected configuration observation limits

A reviewed read-only probe has fingerprinted and classified the selected
protected XML-curl file as described above. Any further authorized observation
must remain bound to the selected host/container and exact path, emitting only owner/mode,
size/SHA256, parser success, binding count/section names, credential/header
allowlisted parameter **names/presence** and TLS-verification/timeout flags; never values
containing secrets, URLs, request bodies or arbitrary config text. Parse with
external entities/expansion disabled and finite byte/file bounds. Retain source
version/package/image metadata and exact binary/module hashes without loading
modules or invoking call-control commands. Request no unreviewed privilege
change; an access refusal stays a refusal. Separately prepare a sanitized
structural diff of the two drifted fixed paths. These observations can select
a future source candidate; they still do not prove loaded lookup/fallback
behavior, which requires an isolated exact-build failure rehearsal.

## Alternatives when that topology cannot be commissioned

- **Containment candidate:** keep existing local emergency/internal/domestic
  routing and install the same terminal protected/unknown fallback denials,
  without enabling the callback. Both protected classes remain off even when
  a stored flag is true; clearly mark positive routing acceptance as pending.
- **Static/SBC topology candidate:** add an authenticated pre-bridge decision
  endpoint backed by the same dedicated reader, returning a strict allow/deny
  bound to the normalized destination and server-resolved caller tenant. A
  small FS Lua gate or Kamailio HTTP gate must require an explicit validated
  allow before its existing bridge/relay, with no continuation on errors.
  It must reject client-set allow markers, cover every transfer/failover/SBC
  branch and preserve media/caller-ID handling. This requires new source and
  independent review; do not parse the presence of a bridge string in XML as
  permission or reuse an unsigned SIP header as an authorization token.

## Qualification, rollback and owner gates

Before approval, retain candidate source hashes, prior configs, include order,
version/module inventory, node/dispatcher map, gateway mapping and a tested
fallback-denial rollback artifact. Platform/routing owner selects the topology;
security reviewer checks identity, direct-SBC and fallback closure. The operator
then schedules the separately authorized rollout and communicates the affected
protected-call behavior to support. No provider calls or configuration reloads
are authorized by this document.

Rehearsal matrix: domestic/internal/emergency still follow their established
paths during policy/backend failure; disabled international/premium never
bridge; enabled international, Thai premium in both formats, and international
premium follow their respective flags; other-tenant/unresolved callers deny;
all failure/failover/transfer cases above deny before carrier egress. Record
source, isolated runtime, deployed routing and provider/device evidence
separately. Do not place a live emergency call as a routine test.

Rollback triggers include unexpected protected egress, routing loops, loss of
established call paths, or incomplete caller/tenant identity. Stop rollout and
restore the retained **guarded containment** route: emergency/internal/domestic
continue, protected calls deny. Restoring an old unguarded catch-all is not an
acceptable enforcement rollback. Keep policy/audit rows and receipts intact;
do not drop migrations, clear flags or weaken LOGIN/RLS to recover routing.
Validate both denied egress and preserved call paths after rollback, then have
the routing owner decide the next candidate.

## Inputs still required

Actual config hashes/mounts/includes and FS build/modules; dispatcher and SBC
paths/ACLs; inbound versus authenticated outbound contexts; trusted caller/domain
propagation; supported destination/carrier normalization; active gateway and
caller-ID mapping; callback network/TLS/header support and timeout/cache/fallback
semantics; fixed-tenant service binding for each served tenant; permitted test
numbers, maintenance window, operator and retained rollback target. The current
adapter binds one tenant per configured backend process, so additional tenants
must not borrow its LOGIN or silently fall back to the shared pool.

Until these inputs are reviewed, a safe live activation cannot be selected.
Escalate that topology decision to the routing owner; keep this proposal at
source stage. See `FRAUD-POLICY-API-INTEGRATION.md` and
`POLICY-RELEASE-RUNBOOK.md` for the separate storage/API qualification gates.
