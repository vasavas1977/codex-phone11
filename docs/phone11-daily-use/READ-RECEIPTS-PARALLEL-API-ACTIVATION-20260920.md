# Phone11 read-receipts parallel API activation evidence

Status on 20 September 2026: **parallel API activation passed**. This record is
deployment evidence for the API candidate and its protected pilot fixture. It
does not claim native handset acceptance.

## Reviewed inputs

- Source commit: `50b6c3b62298b21baa778053d08ce1054422c608`
- Independently reviewed operator SHA-256:
  `21b2ae9f0a7d1dce7165d765269f8241624450a8b1655bd594f611cb2a4b3b25`
- Reuse manifest SHA-256:
  `c0903c34056dddc79d17a0e19640d9343469d47456abb7942ee4aaec04e2c2d0`
- Reused candidate container:
  `d26fbe5127bb5d4f8debdbb3bebd2b586d9b18b8724791bae2e2d91d69c767c7`
- Canonical candidate runtime-shape SHA-256:
  `7d7128528279af2ff3549856c3dfa0c5a8b87dd7b5fa90d010653bfcda8b229c`

The reuse manifest differs from the first manifest only at `candidate.reuse`.
Before execution, the operator copy and manifest were root-owned mode `0600`.
The running candidate matched the pinned image, build, runtime role, loopback
port binding, healthy state and health response, constructor health check,
configuration labels, mounts, networks, and complete runtime fingerprint. Its
effective environment matched the active backend outside the five reviewed
candidate overrides. The original proxy and prior rollback receipt also
matched their pins. Compose was not invoked and the candidate was not
recreated.

## Guarded activation

The approved operator returned:

```text
prepare=READY activation=NOT_RUN
activation=PASS
```

The complete five-probe set passed directly on loopback port 3002 before the
Nginx file write. After reload, the authenticated `phone.getConfig` GET passed
the local `Host: api.phone11.ai` build-marker check and three consecutive fresh
public build-marker checks. Only then did the complete five-probe public set
run. The active Nginx site SHA-256 is
`13684b606403a9757f5a74d3d586cc3cf7f21dc482cdd4398f8762e07f574daf`,
equal to the rollback receipt's active hash. The protected original remains
`6f1d6e0a5b9805e076f7340abe4ae5b505f0fcac8b280df0d83e82f36bd29c5d`.
Rollback receipt SHA-256:
`f6addb76d6ef36fa6cf861feae24d0a65ecaf2b2b7d3bd00b5db27cd06bf4d59`.

Public DNS continues to terminate on the separate production-backend EC2
instance and forward `api.phone11.ai` directly to the Phone11 host on port 80.
The candidate build header therefore attests the target Nginx worker generation
across the complete ingress path. Existing duplicate enabled-site warnings on
the edge were diagnosed but were not changed in this rollout.

## Post-activation acceptance

All checks below passed without printing protected response bodies, bearer
tokens, SIP credentials, database URLs, or provider credentials:

- The baseline container ID and immutable image remained unchanged and healthy
  on port 3000.
- The exact candidate container ID remained unchanged and healthy on loopback
  port 3002.
- Kamailio's pinned runtime configuration and port-3000 wake target remained
  unchanged.
- The candidate database session reported `lock_timeout=2s` and
  `statement_timeout=30s`.
- Public presence capability, read-receipt summary, read-receipt details, and
  typing GETs carried the exact candidate build marker.
- Repeating the pilot recipient's read publication preserved the first
  `readAt` timestamp.
- A mismatched chat-owner assertion was denied, and the recipient was denied
  access to sender-only receipt details.
- A fresh synthetic typing session became observable to the other pilot user,
  then was explicitly made inactive and no longer appeared.
- A fresh synthetic presence session became available, then was explicitly
  made inactive and returned to offline. Cleanup completed successfully.

The separate conference schema is present without admission records, so
conference capabilities remain unavailable until its reviewed fixture handoff.
Remaining acceptance gates are independent owner verification of the public
route and native two-handset Team Chat behavior. No native build, SIP route,
wake route, baseline container, provider admission, or customer conversation
was changed by this activation.
