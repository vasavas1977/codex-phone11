# Voicemail prerequisite before candidate start — 5 October 2026

Source gate only. No helper staging, Docker command, schema change, deployment,
deposit, flag activation or device acceptance was performed for this change.

The candidate-start operator now requires a protected fresh prerequisite packet
before Docker creation and checks it again before the existing start receipt.
Its manifest, start-receipt and route-operator formats are unchanged. The start
CLI retains `--manifest` and adds required `--voicemail-prerequisite` and
`--voicemail-source-root`; an old invocation fails closed. Both process flags
must be off. Protected-mode commissioning needs a separately reviewed operator.

The packet parser reads files only. It checks exact candidate manifest fields,
the backend predecessor ID/image/runtime hash, the named FreeSWITCH ID/image/
runtime hash, both reviewed helper copies and private installed-file snapshots.
The reviewed helper revision is `b13fd44014152378bbf6b100144b8035bb0b7cb5`;
future helper changes require an independently reviewed verifier pin update.
It rejects missing/extra/duplicate fields, unknown module/readability assertions,
stale or future observations, flag mismatches and unsafe private files. Receipt
and snapshots are regular single-link root-owned 0600 files in root-owned 0700
directories. Source files are root-owned and not writable by group/others;
symlink path components and group/other-writable ancestors are refused.
Package `phone11-voicemail-release-prerequisite.py` alongside the existing start
operator; the route operator imports that start module, so retain the reviewed
complete operator set for recovery.

The existing candidate operator independently checks the named backend and
FreeSWITCH container identities, running state, runtime hashes and configured
flags; it hashes installed helpers/configuration using the immutable verified
FreeSWITCH container ID. It repeats those checks and requires unchanged packet
bytes before emitting the start receipt. Failed final validation retains the
existing cleanup behavior for only the newly created, identified candidate.
The start receipt remains proof of its original workerless-candidate scope.

Process read access and successful loaded-Lua probe are **caller attestation**.
Packet validation and direct file/configuration hashes do not authenticate that
attestation or establish commissioning, legacy deposits, rollback, routing-map,
durable-storage, database-writer, provider or physical-device acceptance.
The barrier is a necessary prerequisite, never an approval certificate. Runtime
checks are bounded observations, not an atomic lock on the FreeSWITCH process.

## Private packet interface

Place `prerequisite.json` and a `snapshot/` directory together in the protected
operator packet directory. `snapshot/` contains exactly named copies of
`phone11_legacy_voicemail.lua`, `phone11_voicemail_deposit.lua` and the active
`modules.conf.xml`. The parser checks the latter has exactly one resolved active
`mod_lua` load and no include/conditional/namespace/DTD constructs. Do not copy
environment files or credentials into this packet. Retain original metadata
receipts unchanged under their separately reviewed access boundary.
The configuration must decode strictly as UTF-8 (ASCII is supported), with no
NULs and no contradictory encoding declaration. Directive checks and XML parsing
consume the same decoded text; UTF-16/32 inputs are refused before parsing.

The following shape is an interface example, not admitted evidence. Replace
every placeholder using separately authorized observations. `candidate` is an
exact copy of the existing manifest's candidate section; `backend` matches its
predecessor. Runtime hashes use the existing operator's `runtime_hash` function;
do not emit the environment used to compute them.

```json
{
  "schema": "phone11-voicemail-release-prerequisite/v1",
  "evidence_source": "caller_attestation",
  "observed_at": "<ISO8601 with timezone, at most 15 minutes old and not future>",
  "reviewed_helper_revision": "b13fd44014152378bbf6b100144b8035bb0b7cb5",
  "candidate": "<replace with the exact candidate object from manifest>",
  "backend": {
    "name": "cp11-api-candidate-sip-consistency",
    "container_id": "<64 hex characters>",
    "image": "sha256:<64 hex characters>",
    "runtime_sha256": "<64 hex characters>",
    "hook_ready": false
  },
  "freeswitch": {
    "name": "p11-freeswitch",
    "container_id": "<64 hex characters>",
    "image": "sha256:<64 hex characters>",
    "runtime_sha256": "<64 hex characters>",
    "hook_ready": false
  },
  "helpers": {
    "phone11_legacy_voicemail.lua": {
      "readable": true,
      "sha256": "6883384f279e1e8876f8b312c8783b3101c18b65d190275fbb870c0bba6dcfad"
    },
    "phone11_voicemail_deposit.lua": {
      "readable": true,
      "sha256": "9552b2c6692c70387fec4eb6f3b13487e2f0f2b69c713a928294670dd86a629b"
    }
  },
  "lua": {
    "module_probe_exit": 0,
    "module_exists": true,
    "modules_config_sha256": "<SHA256 of the supplied exact active config>"
  }
}
```

The runtime configuration path is pinned to
`/etc/freeswitch/autoload_configs/modules.conf.xml`. A different real runtime
layout requires reviewed operator adaptation; do not fabricate a snapshot.
Only the exact string `true` enables the flag under the existing helper
contract. A verified absent/other process flag is off; an unobserved flag is
unknown and cannot justify the required `false` assertion. A failed/null module
probe is unknown and cannot justify exit zero or `module_exists: true`.

## Operator execution packet for later authorization

1. Pin the current backend, FreeSWITCH, protected source bundle and retained
   recovery artifacts. Obtain separately reviewed helper staging/module repair
   if needed, with both flags off. Collect installed helper/config snapshots,
   process-readability and successful loaded-module evidence under bounded
   read-only authority. This source change supplies no staging authorization.
2. Independently validate the packet's provenance and the actual source/runtime
   mapping. Rehearse legacy calling/deposits and rollback under the existing
   [routing prerequisites](../../server/pbx/VOICEMAIL-ROUTING.md). Those results
   cannot be inferred from this parser or from a candidate health response.
3. Once candidate-start authority is separately granted, the executable command
   interface is:

```sh
sudo python3 scripts/phone11-mainline-release-start.py \
  --manifest /root/phone11-release/manifest.json \
  --voicemail-prerequisite /root/phone11-release/voicemail/prerequisite.json \
  --voicemail-source-root /root/phone11-release/source
```

These are private packet locations to prepare, not paths established on the live
host. The command creates a workerless loopback candidate and has operational
effects; it was not executed. Public routing still uses its existing separately
authorized route operator. The PBX shared-superuser transition, protected clone,
live migration definitions, real admitted deposit and signed-device playback
remain open under their existing gates.
