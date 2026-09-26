# Private voicemail API candidate — 27 September 2026

The candidate is running on **127.0.0.1:3013 only**. It is not the public API
and is not the FreeSWITCH directory target. Voicemail and DND remain off.
Workspace status continues on the unchanged live 3012 API.

## Reviewed and staged bytes

- API source: `daa18777b7c38ce04bd3cf016cf5ca15d38f2e67`.
- API bundle SHA-256: `0959ec332a8769083fe629405d14b73e45faef392639b5e05b1186ff2dd4de4a`.
- Lock SHA-256: `24a72aa60f0b43fe3afdad41f2e0f0f348f75ac065172627913fe72d43f2c801`.
- Staging operator: `c586f932d516bcc842910d9b5068e1338b705aad`, SHA-256
  `71ce816947f8e6c6eb24a8ecf95dd7b5e3837029dd8a355a1b03328996616eb7`.
- Image: `sha256:0b1d80755c400eb59fa7fd75493b3a78cf4b39ea2cc65732aaf17231ca93ca75`.
- Container name: `cp11-api-candidate-voicemail`.
- Runtime role: `api-candidate`; voicemail hook: `false`.
- Build: `voicemail-api-daa1877`.

The source and operator received independent source approvals. The final operator
passed 13 focused Python tests. Its legacy Docker compatibility change uses a
0644 nonsecret bundle inside a root-owned 0700 build context; release inputs and
credential-bearing files remain 0600. The failed BuildKit-only context is retained
as pinned evidence. No Docker engine update was needed.

Release inputs are root-private at
`/var/lib/phone11-voicemail-api-release-20260927`; operator state is at
`/var/lib/phone11-voicemail-api-stage`. Do not print the generated environment,
Compose document, directory credential XML, or old XML-curl URL.

## Runtime checks actually observed

The operator returned `prepare=READY`, `build=READY`, and `start=READY`.
Using the configured integration credential in memory against loopback 3013:

| Case | Result |
| --- | --- |
| Basic-auth directory lookup for 3001 | HTTP 200; exactly matching user and credential present |
| Basic-auth directory lookup for 1020 | HTTP 200; exactly matching user and credential present |
| Missing authentication | HTTP 403 |
| Incorrect Basic authentication | HTTP 403 |
| Simultaneous Basic and secret-header authentication | HTTP 403 |
| Credential supplied in form body | HTTP 403 |
| Correct authentication, wrong SIP domain | HTTP 200; no user |

The protected `unchanged-baseline.json` comparison passed after candidate startup:
Nginx, Kamailio, FreeSWITCH directory/dialplan files and the existing backend,
status API, FreeSWITCH and Kamailio container identities/running state were
unchanged. Independent read-only runtime postcheck passed: it verified the root
file modes, clean source, exact environment, nonroot bundle readability, pinned
image/configuration, failed-context archive, health response, and unchanged baseline.
This is approval of private staging only.

## Scope still pending

Actual FreeSWITCH XML-curl Basic-auth validation and a reviewed paired directory
configuration are required before changing its live binding. The isolated
Kamailio fixture passed six synthetic SIP scenarios (see its runtime evidence),
but it is not a live voicemail route, media proof or handset acceptance. No storage
migration, producer/relay activation, mailbox enablement, DND enablement, live
call-route change or new handset call test was performed by this stage.
