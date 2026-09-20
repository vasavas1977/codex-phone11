# Parallel API activation contract — pending implementation

Purpose: deploy the admitted conference/presence API without replacing the backend that currently owns working SIP wake, recording, and dispatch workers. This is a bounded operator specification, not evidence of deployment.

## Observed baseline

On 20 September 2026, `cp11-backend` used immutable image `sha256:d42c70f34d5062bff779c235dd2b6e415bede3b3a86b9de73892acf35b392619` and served loopback port 3000. Kamailio's wake URL directly targets `http://127.0.0.1:3000/api/phone11/wake`. Nginx forwards the general API to 3000. Port 3001 belongs to a legacy process; 3002 was free at inspection. Recheck all these facts before mutation.

The old conference activation operator remains blocked at `maintenance_drain`. Do not remove that guard or reuse its replacement-container mutation sequence for this parallel approach.

## Required operator behavior

1. Pin and revalidate the active image, container identity, mounts, network, loopback binding, health, Nginx configuration fingerprint, and direct wake target. Do not print environment values or credentials.
2. Build one immutable candidate from the exact live baseline plus explicitly reviewed source changes. Do not package the heavily dirty canonical checkout wholesale. Candidate health must identify the reviewed build and `runtimeRole: api-candidate`.
3. Set `PHONE11_RUNTIME_ROLE=api-candidate` and explicit `PORT=3002`; bind host loopback only. Keep the current backend/container and every worker unchanged. Runtime-role tests must verify disabled worker startup, not just environment parsing.
4. Validate the protected Connect11 credential metadata and explicit Phone11 tenant/customer mapping. Apply only reviewed backward-compatible migrations with bounded locks and timeouts; verify membership-scoped pilot admission fixtures before Meet is advertised. The protected credential installer alone must not activate or restart anything.
5. Before proxy changes, prove candidate health and authenticated read-only calls against both conference and existing chat/phone routes, including a mixed tRPC batch. A failed tenant admission must remain unavailable. Never return a token or credential in operator logs.
6. Route exact `/api/trpc` and prefix `/api/trpc/` to 3002, preserving path, query, method, body, authorization, cookies, and forwarding headers. All other routes—including wake/media/health—stay on the existing backend unless separately reviewed. Validate Nginx syntax, atomically install the reviewed fragment, and gracefully reload.
7. Verify existing container identity and workers did not change. Verify public mixed tRPC and conference capability plus the direct wake target. Proxy rollback must atomically restore the prior configuration and gracefully reload without stopping either backend. Keep the candidate alive until its outstanding requests are drained.
8. Treat process-local typing leases as transient: a proxy transition can briefly clear typing; multiple concurrently load-balanced API replicas require a shared ephemeral store before rollout. Presence uses database leases and must remain coherent across the transition.

## Required tests and acceptance

Hermetic operator tests must reject unexpected baseline, occupied port, wrong role/build, credential mismatch, malformed Nginx route, stale config fingerprint, failed health, mixed-batch/auth regression, migration failure, and unsafe rollback. Exercise actual process startup to prove no duplicate recording/notification/ESL workers start. Review production-mutating code independently before execution.

Production evidence and two-iPhone acceptance are separate: presence changes across open/background/call/meeting/ended/offline states; typing clears after send/exit; video pilot covers camera/microphone, both-way media, leave/rejoin, reconnect, and SIP interruption. No source test or browser preview proves handset audio/video.
