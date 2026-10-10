# Production target observation — 8 October 2026

The owner confirmed the existing Phone11 PBX EC2 at `43.210.122.111` as the
commissioning target. Fresh AWS metadata identifies instance
`i-0851dd1ea1cfeef71`, running in `ap-southeast-7a`. Strict SSH using the existing
known host binding returned `ip-10-0-1-69`. Existing EC2 Instance Connect access
was used; no new key or persistent SSH configuration was created.

The public portal/API edge is a separate running instance,
`i-0cc8f248b08c5f2fb` at `43.209.112.208` in `ap-southeast-7b`. Public DNS and
strict SSH agree with that binding. The existing static controller's fixed edge
probe therefore remains correct; the PBX decision does not change its target.

## Observed portal and API state

The portal's root-owned managed static receipt and current symlink both identify
source `63203c8910ff09ba59eeb6dfcba1f58c769bface`. All retained export leaves match
its manifest. The live site and receipt's saved site share SHA-256
`e3ca95837a5017913a079059f1cfdc13820c236d09bb8d3a4f35ecc434a4020f`;
the complete Nginx stdout configuration dump has SHA-256
`9f08b86f87a3ca0268f26b29164fca785ad3c95462e5bd9c733eacc121e79c5d`.
Both historical duplicate enabled includes remain absent. No static activation
or Nginx change occurred during this observation.

The edge forwards API traffic to the PBX host. The PBX's active site matches the
retained admission configuration hash
`1eebf1ec8738be9b585a68ad031e188bb3a8aede41d9d4f4fff085843accbe86`.
The healthy admission candidate on loopback port 3023 has full container ID
`e131fc321a0653319cfa05642a9d22f5d48bb14149c4d212c1ab27b1c47dfca2`,
image digest
`sha256:b049382f9f815e3aa9fc1b620b87f5a7072df48266aa0029914fdc927ea12bb9`
and `/app/dist/index.mjs` SHA-256
`d1d88c2d95fe6094b26ec046ecd17043e0e706c59c2a91850b6dfc4ff7829232`.
The retained mainline candidate on 3022 also remains running. Historical
operators that assume 3016 must not be used against this observed topology.

## Commissioning limits

The existing local PostgreSQL, Kamailio, FreeSWITCH and voicemail relay containers
were identified through bounded Docker metadata. This does not establish their
database principals, schema compatibility, independent protected backup/clone,
trunk authorization, durable voicemail custody or provider acceptance. No
Docker environment, credential value, raw application log or customer row was
inspected or exposed to the assistant. An observer connection has not yet been
bound to the target; no SQL, migration, service restart, SIP RPC or test call
occurred.

The independently reviewed `abca591` web export remains an undeployed historical
candidate. Compatibility analysis found that its workspace selection can display
implicit legacy tenant reads under the wrong selected company. A corrected web
candidate needs its own committed source, export pins and compatibility review;
the old artifact must not be relabelled. Normal authenticated portal navigation
can refresh login sessions on the retained API and is not a strictly database
mutation-free probe.

Siprix remains the owner's confirmed 60-second trial. Publisher signing,
notarization, unrestricted production licensing and owner-deferred physical
phone/meeting acceptance remain separate release requirements.
