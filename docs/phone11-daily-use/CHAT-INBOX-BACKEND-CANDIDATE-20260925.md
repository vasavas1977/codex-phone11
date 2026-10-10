# Team Chat inbox backend candidate (source preparation)

Team Chat `chat.list` uses the public `/api/trpc` route. On 2026-09-25, a read-only check of the VoIP host found both exact and prefix tRPC locations on `127.0.0.1:3009`. The public `/api/health` endpoint is served by the retained worker runtime and does not identify the tRPC candidate.

## Live predecessor pinned for review

- Host: VoIP instance `i-0851dd1ea1cfeef71` in `ap-southeast-7a`; Nginx site `/etc/nginx/sites-enabled/phone11ai` SHA-256 `67017c07eca453b2856db5afc11d499cfc4a57822d17f8e5237a05ae2452d514`.
- tRPC predecessor: `cp11-api-candidate-meeting-title`, loopback `3009`, image `sha256:c66d4e95e4177a75bb4a3c0c6a900de80c57f071b0b3d8d7daa45332404b2398`, health build `meeting-title-20260925`, runtime role `api-candidate`.
- Source `d67be349fbedbda0d4d441c3e0d958ae1481611a`; running and staged `/opt/phone11ai/meeting-title-20260925/dist/index.mjs` bundle SHA-256 `870fdad722679a67575a57c27fee5131c2128aa75d97d201064588c76cb0292e`. Its image is a one-file overlay on image `sha256:d23a97bd859bb2788802fe50debc0d5551a1125d3b879d62277016f41fa0bd22`.
- An offline esbuild of the unchanged `d67be349` server source reproduced the running bundle SHA-256 exactly. The earlier 3008 container remains a separate rollback candidate; the next release preserves the current 3009 predecessor.

The isolated source candidate starts at `d67be349` and applies only reviewed commits `d38fb0d` and `1dc967f` to `server/chat/service.ts`, `lib/chat/types.ts`, and `tests/phone11-chat-postgres.test.ts`. It does not add a schema migration. The list query uses one unread-range aggregate for unread and mention counts, keeps sender identity with the latest message, and labels an empty-body attachment preview from tenant-scoped attached media rows. It omits mention totals on older schemas without mention tables.

## Sealed candidate pins

| Item | Pin |
| --- | --- |
| Candidate source commit | `2d125819a7f1713f05b3eaa3bcbf5e5672a84e0c` |
| Candidate bundle SHA-256 | `75381c01555e1d924eddc2da2c97a1f1e44224dec5c4f03947518e24f6148b5b` |
| Candidate build marker | `chat-inbox-20260925` |
| Staging on VoIP host | `/opt/phone11ai/chat-inbox-20260925/dist/index.mjs` |
| Target container and port | `cp11-api-candidate-chat-inbox`, `127.0.0.1:3010` |
| Candidate image ID | unknown until separate host build and audit |

## Controlled release path after independent review

1. Recheck the exact site, image, running bundle, 3009 health, available 3010 port, and staged candidate bundle at action time. Copy only the reviewed bundle and three pinned `phone11-chat-inbox-*` operators to a root-controlled staging directory. Keep protected runtime values out of logs and local artifacts.
2. Run `phone11-chat-inbox-overlay-image.py --bundle-path /opt/phone11ai/chat-inbox-20260925/dist/index.mjs` on the host. It requires the exact parent image and running bundle, uses an offline Docker build with no pull, audits the inherited runtime and one-file layer, and returns the new immutable image ID. It does not start a container or change the route.
3. After reviewing the image ID and labels, run `phone11-chat-inbox-release-start.py --image-sha256 <64-hex-image-id>`. It clones only the protected candidate runtime, passes its environment to Docker through an inherited Linux memory file descriptor, creates a separate loopback 3010 service, verifies health and the running bundle, and leaves the public route on 3009. It never prints or writes the cloned environment to disk. Verify authenticated `chat.list` sender identity, unread mention counts, deleted/read and cross-tenant cases; also probe existing phone and meeting tRPC behavior against 3010.
4. Run `phone11-chat-inbox-release-route.py inventory`, then `prepare --image-sha256 <same-id>`. Prepare checks the exact 3009 predecessor, 3010 candidate, and current site hash, then seals root-only before/after site files and a receipt without changing Nginx. Inspect that receipt and the exact two-line tRPC change before activation.
5. After acceptance, run `activate --receipt-dir <prepared-receipt-dir>`. The operator rechecks its pins, changes only the two tRPC proxy targets from 3009 to 3010, validates and reloads Nginx, and attempts to restore the original site if validation fails. Verify the public authenticated behavior and tenant boundary. Retain 3009 and its existing release receipt.
6. If acceptance fails, run `rollback --receipt-dir <same-receipt-dir>`. It requires the sealed active site and healthy pinned 3009 predecessor, restores the exact prior site and reloads Nginx. Any drift or failed restoration requires manual review.

The isolated candidate passed `tsc --noEmit`, the backend esbuild command, and 13 non-database chat tests; the PostgreSQL suite reported 50 skipped without a local database. The copied operator logic passed 9 image-layer and 11 route/start tests. A separate disposable PostgreSQL 17 run against the reviewed shared-branch delta passed five focused cases, but that is not a hosted database or isolated candidate run. None of these checks proves a host-built image, a live route change, or a device result. No production action is part of this source preparation.
