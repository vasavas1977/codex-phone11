# Phone11 tenant-settings candidate at 3005

This is a source-only operator extension. It does not authorize an image build, database migration, Nginx change, container start, restart, routing change, credential use, or release of the tenant-settings feature.

## Fixed topology

The existing v1 blue/green path remains unchanged for its original `3002 → 3003` topology. The new `phone11-candidate-bluegreen/v2` manifest is selected only by `--settings-topology` during inventory and accepts one exact topology:

| Slot | Container | Loopback port | Required state |
| --- | --- | --- | --- |
| Baseline | `cp11-backend` | 3000 | Healthy and pinned |
| Retained candidate | `cp11-api-candidate` | 3002 | Healthy and pinned |
| Current tRPC candidate | `cp11-api-candidate-next` | 3003 | Healthy, pinned, and the current exact tRPC route |
| Password-recovery candidate | `cp11-password-recovery` | 3004 | Healthy and pinned |
| New settings candidate | `cp11-api-candidate-settings` | 3005 | Must be absent before activation |

The v2 target service is `candidate_settings` under Compose project `phone11-api-settings-candidate`. Inventory rejects a changed slot name, port, role, service, project, already-present target, an occupied 3005 port, a missing or altered exact four-location recovery fragment, image-label mismatch, Compose/render drift, or a nonexact 3003 tRPC fragment. The operator clones only the pinned 3003 service and changes only its target identity, build marker, healthcheck port, and loopback port to 3005.

Rollback evidence is intentionally separate from v1: v2 writes only under `/var/lib/phone11-candidate-bluegreen-settings`. Its receipt pins the v2 schema and `settings-3003-to-3005` topology, so a legacy v1 receipt cannot be reused.

## Later operator sequence

After an independently reviewed exact source head and a locally verified candidate image are available, an authorized host operator may create a new protected manifest with placeholders replaced by the reviewed values:

```sh
python3 phone11-candidate-bluegreen.py --inventory --settings-topology \
  --output /root/phone11-candidate-settings-9804c2f.json \
  --current-compose-file /root/ACTIVE_3003_COMPOSE.json \
  --probes-file /root/EXISTING_PROBES.json \
  --nginx-site /etc/nginx/sites-enabled/phone11ai \
  --release-image sha256:REVIEWED_IMAGE_DIGEST \
  --release-build settings-9804c2f \
  --release-source-sha 9804c2f09f99453747e0bb54e23d3b6149f5b5cb \
  --tenant-id 1 --denied-tenant-id 2147483647
```

`ACTIVE_3003_COMPOSE.json` must be a protected Compose document that renders exactly one service whose `container_name` is `cp11-api-candidate-next` on 3003 with the currently pinned runtime image and environment. The old 3002 Compose input cannot stand in for it. Inventory is read-only. `--prepare` uses the v2 manifest and must return ready before any target is created. `--activate` may only start the fixed 3005 target and move the exact and prefix `/api/trpc` locations from 3003 to 3005. It rechecks the 3000, 3002, 3003, and 3004 runtime pins before target creation, after target readiness, and after routing.

The migration remains an operator-controlled next step. The application never applies `tenant-settings-migration.sql`; a source package, image, v2 inventory, and prepare result are not migration, deployment, provider, or handset acceptance evidence.

## Source validation

The focused Python suite preserves the eleven v1 checks and adds six v2 checks for fixed topology admission, 3003-to-3005 cloning, preservation of all four existing runtime slots, 3005 absence, v2 inventory selection/sealing, and receipt separation. An independent security review of the exact final source head is required before any production operation.
