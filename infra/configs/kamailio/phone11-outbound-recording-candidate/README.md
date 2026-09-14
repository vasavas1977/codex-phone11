# Outbound recording identity candidate

This metadata-only helper preserves the existing FreeSWITCH destination and all
media/dialog handling. It is disabled unless explicitly included and configured.
The current live outbound route uses local FreeSWITCH XML; it does not invoke
the backend's old mod_xml_curl recording binder.

After the existing `auth_check` succeeds, before any auth header removal, save:

```kamailio
$avp(phone11_recording_auth_user) = $au;
$avp(phone11_recording_auth_realm) = $ar;
```

Never set these AVPs from From, caller ID, or a client header. Define
`WITH_PHONE11_OUTBOUND_RECORDING`, `PHONE11_OUTBOUND_RECORDING_USER` (the one
commissioned SIP account), and `PHONE11_OUTBOUND_RECORDING_REALM` (its exact
realm), include `routes.inc`, then call
`route(PHONE11_OUTBOUND_RECORDING_IDENTITY)` inside `TO_FREESWITCH` before auth
headers are removed. The helper strips all client copies of the internal
identity headers, rejects duplicate/malformed correlation values, and adds a
single canonical set only for the configured account's ordinary PSTN INVITE.
The correlation value must be an RFC 4122 UUIDv4 and is forwarded in canonical
lowercase form. Missing auth AVPs fail closed without attempting null/string
comparisons.
Emergency/feature/internal routes receive no recording markers.

The app generates a UUID once before inviting and persists
`native-outbound:<uuid>`. The UUID is only a correlation handle; it conveys no
ownership. The backend must require an authenticated ESL snapshot from the
configured exact proxy IP, an inbound FreeSWITCH A-leg with logical outbound
call direction, the protected user/realm, and one active matching SIP account.
Only then may it bind that channel and native history ID. Missing/ambiguous
identity and reused correlation IDs must remain unbound.

Deployment requires a protected live-config backup, parser verification using
the live image, isolated SIP regression tests, zero active FreeSWITCH channels
and Kamailio dialogs, and the signed app containing the UUID transport. Do not
change the working media flags or re-enable the generic XML-curl dialplan as a
side effect. Verify one outgoing handset call before expanding beyond the
commissioned account.

Primary references:
- https://www.kamailio.org/docs/modules/stable/modules/auth_db.html
- https://www.kamailio.org/docs/modules/5.8.x/modules/auth.html#auth.pv_auth_check
- https://www.kamailio.org/docs/modules/stable/modules/textops.html

## Isolated real-Kamailio regression

The fixture in `tests/fixtures/phone11-outbound-recording` launches Kamailio
5.8.4 and a UDP SIP client in one container on loopback. It performs real
Proxy-Authorization digest challenges and verifies both forwarded SIP messages
and rejected authentication attempts. It has no external network and publishes
no ports at runtime. See that fixture's README for the exact command.
