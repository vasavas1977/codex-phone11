# Restored-clone custody consistency

`restore-custody-v3.ts` is an additive, pure validator for a protected snapshot-backed PostgreSQL clone and an isolated worker. It keeps the synthetic-only v2 contract unchanged.

The v3 observation binds independent image, container, system and archive identities; private storage and network isolation; eight categories of catalog semantics before and after restoration; and metadata from a restricted, password-authenticated clone login. The PostgreSQL role archive excludes role passwords. The full database archive can contain protected application password hashes, encrypted SIP material and other credentials.

Successful validation means metadata consistency only. It does not authenticate an observer, establish a restore, grant runtime authority, or admit production use. The selected handler and real PostgreSQL adapter remain unbound; their NULL admission pins are unchanged.

The initial protected-baseline producer reports two combined fingerprints and three secret leaves. It cannot satisfy this separate eight-category, four-leaf contract. A reviewed producer and actual restricted-login observations are required before binding the handler.

Validation: 64 new contract cases and 74 existing synthetic custody cases passed. Full TypeScript and targeted lint passed. Independent source review included eight additional adversarial cases. No database, restore or provider action is claimed by these checks.
