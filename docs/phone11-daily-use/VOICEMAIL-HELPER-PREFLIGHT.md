# File-only voicemail helper/runtime preflight

Run `pnpm exec tsx scripts/phone11-voicemail-helper-preflight.ts --kind target
--helpers-dir /private/snapshot/scripts --modules-config /private/snapshot/modules.conf.xml
--evidence /private/snapshot/normalized-evidence.json` as one command. Use
`--kind staging` for an uninstalled candidate. Optional `--source-root` selects
the checkout containing both reviewed helper copies. This tool reads local
files only. It performs no SSH, authentication, subprocess, network, deployment,
configuration, schema, flag or target writes. Keep snapshots and receipts private.

The reviewed helper hashes are pinned to source
`b13fd44014152378bbf6b100144b8035bb0b7cb5`. Both deploy and infrastructure
copies must match those exact pins. Supplied bytes must match them too; a new
reviewed helper revision requires a separately reviewed verifier pin update.
Missing snapshot files fail compatibility; that result does not claim the
runtime host lacks the file. Unreadable files remain unknown. Only fixed issue
codes and helper/configuration hashes are emitted, never paths, receipt text,
target identity or process environment. Inputs are regular files capped at 1 MiB.

Caller evidence must be a JSON object with exactly this shape. Placeholders
below must be replaced by the actual private observation and computed hashes:

```json
{
  "version": 1,
  "scope": "target",
  "targetIdSha256": "<SHA-256 of the privately pinned runtime identity>",
  "observedAt": "2026-10-04T04:00:00+00:00",
  "modulesConfigSha256": "<SHA-256 of the supplied exact runtime config>",
  "backendHookReady": false,
  "freeswitchHookReady": false,
  "moduleProbeExit": 0,
  "luaModuleExists": true,
  "helpers": [
    {
      "name": "phone11_legacy_voicemail.lua",
      "readable": true,
      "sha256": "6883384f279e1e8876f8b312c8783b3101c18b65d190275fbb870c0bba6dcfad"
    },
    {
      "name": "phone11_voicemail_deposit.lua",
      "readable": true,
      "sha256": "9552b2c6692c70387fec4eb6f3b13487e2f0f2b69c713a928294670dd86a629b"
    }
  ]
}
```

Normalize only evidence obtained under separate read-only authority. This tool
does not collect observations or convert legacy receipts. Retain the original
receipt unchanged. `moduleProbeExit` describes the existing `module_exists
mod_lua` probe in the exact pinned FreeSWITCH process. Any nonzero/null exit
makes Lua **unknown**, even with a recorded false boolean. Only exit zero and
an explicit false result establishes module absence. Do not replace failed
probe results with inferred success from image tags, packages or configuration.

Use null for an unobserved flag, boolean, exit or helper digest. Convert process
`PHONE11_VOICEMAIL_HOOK_READY` values according to the actual helper contract:
only the exact string `true` is enabled; a verified absent or other value is
disabled. A missing observation remains null. Do not use SIP/channel variables,
Compose defaults or a backend image's environment as a FreeSWITCH observation.
Helper `readable` is the pinned runtime process's read access, not local access
to copied bytes. Match `/etc/freeswitch/scripts/<helper-name>` and the exact
active `modules.conf.xml` privately before normalizing. The receipt is caller
attestation; this tool cannot authenticate its provenance or runtime identity.

Evidence must match the input scope and helper/configuration digests and be at
most 15 minutes old (at most one minute in the future). Required configuration
is valid XML with one active `load module="mod_lua"` under
`configuration name="modules.conf"/modules`. Comments do not count. Malformed
XML, DOCTYPEs, processing instructions and unresolved FreeSWITCH include or
namespace templates remain unknown: supply the resolved exact configuration
rather than guessing it. Configured loading still needs successful runtime proof.

The single JSON output reports `overall` as compatible/incompatible/unknown;
exit codes are 0/2/1 respectively. Every unknown or mismatch fails readiness.
Matching flags report legacy or protected mode; either mismatch is incompatible.
`helperRuntimeReady` requires compatible fresh **target** observations;
`flagOffRehearsalReady` additionally requires both flags off. Compatible staging
inputs never assert installed readiness. Both flags on can be mechanically
compatible while flag-off rehearsal readiness stays false.

`commissioningApproved` and `rolloutApproved` are always false. This preflight
checks a bounded helper/interpreter prerequisite, not full voicemail readiness:
it does not establish cache invalidation, drained calls, runner/producer/outbox,
durable storage, schema/owner epochs, provider deposit/replay, rollback behavior,
authentication or physical playback. Follow the separately approved
[routing prerequisites](../../server/pbx/VOICEMAIL-ROUTING.md). Failed probes,
unknown active configuration and missing target bindings need fresh authorized
evidence; no source test or fabricated normalized receipt closes those gates.
