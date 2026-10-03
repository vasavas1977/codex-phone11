# Settings candidate Compose recovery at 3005

`scripts/phone11-settings-compose-recovery.py` is a source-recovery helper for
the deleted Compose path recorded in the running 3005 settings candidate's
Docker labels. It does not start, stop, restart, recreate, inspect logs from,
or execute commands in a container. It reads one Docker inspection, invokes
`docker compose config --format json` only to parse a private temporary file,
and publishes the recovered source only after that render matches the inspected
runtime contract.

This is not candidate activation, routing, migration, channel enablement,
tenant permission, provider, or browser acceptance evidence.

## Required redacted facts

The operator caller must independently record these non-secret facts from a
fresh read-only inspection and pass the exact container ID, image digest, and
build marker. The current settings candidate evidence is:

| Fact | Required value |
| --- | --- |
| Container | `cp11-api-candidate-settings` |
| ID | `e927176b48887d62d7ebdcb934b60366f6e41ca2951df8a47d784fbca57b12b6` |
| Image | `sha256:2669c5032ebda82381c2e1c947cbd804132457355bb05931f1e921d064f1c8a9` |
| Build | `settings-9804c2f` |
| Compose identity | project `phone11-api-settings-candidate`, service `candidate_settings` |
| Network | external `cloudphone11-prod_cp11-net` |
| Bind | only loopback `127.0.0.1:3005` to `3005/tcp` |
| Exposed ports | `3000/tcp`, `3005/tcp` |
| Runtime model | unprivileged, read-write root filesystem, private IPC, 2 GiB memory limit, no CPU or PID limit, default JSON-file log driver |

It also requires exactly the five existing bind mounts and their read/write and
propagation modes, the effective environment map, entrypoint, command, user,
working directory, healthcheck test and timings, restart policy, external
network, application labels, and no added capabilities, security options,
devices, or device requests. Environment values are copied only to the private
Compose JSON; they are never written to stdout, evidence, or this document.

## Fail-closed recovery

After source review, an owner can use this exact shape of command with the
freshly read pins:

```sh
python3 scripts/phone11-settings-compose-recovery.py \
  --output /root/phone11-current-3005-recovered-compose.json \
  --expected-container-id e927176b48887d62d7ebdcb934b60366f6e41ca2951df8a47d784fbca57b12b6 \
  --expected-image sha256:2669c5032ebda82381c2e1c947cbd804132457355bb05931f1e921d064f1c8a9 \
  --expected-build settings-9804c2f
```

The output name must be a new file directly under `/root`. The helper creates a
private `0600` root-owned temporary source, renders it, verifies the canonical
Compose service against the inspected runtime, then hard-links it into the
requested final name. An existing output name blocks before Docker inspection;
a failed render removes the temporary file without publishing it. The final
file is verified root-owned, `0600`, regular, non-linked, and byte exact before
the helper reports only its SHA-256 and non-secret runtime/render hashes.

The source is eligible for a later v3 inventory only when its reported hashes,
fresh Docker inspection, and independently reviewed helper source all agree.
The currently missing `/tmp/phone11-api-candidate.pu38gw85/compose.json` must
not be substituted with a retained 3002/3003 source, reconstructed environment,
or manually edited file.
