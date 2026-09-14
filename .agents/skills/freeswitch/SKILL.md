---
name: freeswitch
description: Use this skill when working with FreeSWITCH configuration, dialplans, modules, channel variables, Event Socket Library, SIP/RTP behavior, installation, troubleshooting, or when answers should be grounded in the SignalWire FreeSWITCH developer documentation mirrored in references.
---

# FreeSWITCH

Use this skill for FreeSWITCH engineering tasks: XML dialplans, Sofia SIP profiles, gateways, modules, channel variables, ESL/API commands, CDRs, conferences, voicemail, installation, upgrades, and debugging production call flows.

## Reference Snapshot

Primary local reference:

- `references/freeswitch-docs/` - mirrored source of `https://developer.signalwire.com/freeswitch/`.
- `references/freeswitch-docs/docs/` - every upstream `.md` / `.mdx` documentation page, preserving Docusaurus paths and relative links.
- `references/freeswitch-docs/README.md` - upstream repository README.
- `references/freeswitch-docs/SOURCE.md` - source commit, sync time, detected FreeSWITCH version refs, file counts, and first-party URLs.
- `references/freeswitch-docs/MANIFEST.md` - local path, public source URL, and GitHub blob URL for every mirrored documentation page.

The reference mirror is markdown-only: `.md` / `.mdx` files. Static assets, Docusaurus config, generated site files, and attachments are intentionally not stored in `references/`.

The upstream documentation is not versioned as a single FreeSWITCH release. Treat this skill as a snapshot of the SignalWire FreeSWITCH docs at the commit recorded in `references/freeswitch-docs/SOURCE.md`. Use the detected release/branch refs in `SOURCE.md` when a user asks which FreeSWITCH version the snapshot targets.

Refresh the mirror with:

```sh
./scripts/sync-freeswitch-docs.sh
```

Optional:

```sh
FREESWITCH_DOCS_REF=main ./scripts/sync-freeswitch-docs.sh
FREESWITCH_DOCS_REF=<commit-or-tag> ./scripts/sync-freeswitch-docs.sh
```

## Lookup Workflow

1. Read `references/freeswitch-docs/SOURCE.md` first when version, provenance, or freshness matters.
2. Use `rg` over `references/freeswitch-docs/docs` for exact names:
   - channel variable: `rg -n "variable_name|variable-name" references/freeswitch-docs/docs/Channel-Variables-Catalog`
   - module: `rg -n "mod_sofia|mod_conference|mod_event_socket" references/freeswitch-docs/docs/FreeSWITCH-Explained/Modules`
   - dialplan app/API: `rg -n "bridge|transfer|uuid_bridge|originate" references/freeswitch-docs/docs`
3. Open only the relevant `.mdx` files after search. Many pages are large; avoid loading whole directories.
4. Follow local relative links as written. If a public citation is needed, use the matching URL in `MANIFEST.md` or the upstream GitHub blob URL.
5. For ambiguous or stale pages, compare against FreeSWITCH source/config examples when available and clearly state uncertainty.

## Answering Rules

- Prefer local mirrored docs over memory.
- Cite the original SignalWire page or GitHub source when giving authoritative docs claims.
- Mention the docs snapshot commit when version precision matters.
- Separate documented behavior from field-tested inference.
- Call out deprecated, Confluence-era, or obviously old installation guidance before using it.
- For production configs, include safety notes: NAT, ACLs, auth, TLS/SRTP, codec negotiation, media bypass, logging level, reload impact, and rollback.

## Common Reference Areas

- Installation and OS packaging: `docs/FreeSWITCH-Explained/Installation/`
- Modules: `docs/FreeSWITCH-Explained/Modules/`
- Channel variables: `docs/Channel-Variables-Catalog/`
- Dialplan and XML configuration: `docs/FreeSWITCH-Explained/Dialplan/` and `docs/FreeSWITCH-Explained/Configuration/`
- Event Socket / ESL: search for `Event Socket`, `mod_event_socket`, `ESL`, `fs_cli`, `api`, `bgapi`.
- Sofia SIP: search for `mod_sofia`, `sofia.conf.xml`, `gateway`, `profile`, `sip_`, `nat`, `rtp`.
- Conferencing: search for `mod_conference`, `conference`, `conference_auto_outcall`.
