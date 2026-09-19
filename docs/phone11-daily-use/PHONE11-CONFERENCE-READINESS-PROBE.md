# Phone11 conference readiness probe

The readiness probe checks the server-side Connect11 plain-video wiring without
contacting Connect11 or minting a meeting token. It reports only presence and
validity summaries. It never prints configuration values, credentials, tenant
identifiers, customer keys, URLs, tokens, provider rooms, or participant
identities.

Run it from the checkout with:

```text
pnpm meetings:readiness
```

For the production-style Compose backend, the image bundles the same probe at
`dist/conference-readiness.mjs`. Run it against the existing `cp11-backend`
container without restarting any service:

```text
docker compose -f infra/compose/docker-compose.prod.yml exec backend node dist/conference-readiness.mjs
```

The probe checks that `PHONE11_CONNECT11_PLAIN_VIDEO_TENANTS` is present and
accepted by the same strict parser used by the router. It checks the meetings
capability contract in-process: unauthenticated callers are rejected and a
disabled provider reports unavailable capabilities. It then inspects the
required PostgreSQL metadata inside a `READ ONLY` transaction and rolls that
transaction back. No migration SQL is read or executed.

A passing result requires an enabled, valid tenant mapping, compatible
prerequisite tables, and the complete plain-video admission schema. A missing
or partial schema remains a failed readiness result and must be handled through
the reviewed migration process separately. The probe does not deploy, restart,
change environment variables, or alter database state.
