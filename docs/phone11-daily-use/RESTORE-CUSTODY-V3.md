# Restored-clone custody consistency

`restore-custody-v3.ts` is an additive, pure validator for a protected snapshot-backed PostgreSQL clone and an isolated worker. It keeps the synthetic-only v2 contract unchanged.

The v3 observation binds independent image, container, system and archive identities; private storage and network isolation; eight categories of catalog semantics before and after restoration; and metadata from a restricted, password-authenticated clone login. The PostgreSQL role archive excludes role passwords. The full database archive can contain protected application password hashes, encrypted SIP material and other credentials.

Successful validation means metadata consistency only. It does not authenticate an observer, establish a restore, grant runtime authority, or admit production use. The selected handler and real PostgreSQL adapter remain unbound; their NULL admission pins are unchanged.

The initial protected-baseline producer reports two combined fingerprints and three secret leaves. It cannot satisfy this separate eight-category, four-leaf contract. A reviewed producer and actual restricted-login observations are required before binding the handler.

Validation: 64 new contract cases and 74 existing synthetic custody cases passed. Full TypeScript and targeted lint passed. Independent source review included eight additional adversarial cases. No database, restore or provider action is claimed by these checks.

The semantic comparison requires `phone11-catalog-semantics-component-arrays/v2`.
Legacy v1, missing and unknown global canonicalization tags are refused even when
an observation digest is recomputed. Source-before, source-after and restored
category maps must still match the separately pinned source semantic digest.
Their contents are opaque metadata: the global tag and digest shape do not
prove which SQL produced them or authenticate their provenance.

A future observation producer must independently bind the same reviewed exact
SQL bytes and v2 canonicalization for all three observations, retain the actual
source/clone evidence, and never relabel or reuse v1 fingerprints as v2. No SQL
SHA is hardcoded here while PostgreSQL diagnosis may still require a correction.
Existing producer/collector shapes and all NULL runtime admissions are unchanged;
no producer edits or actual PostgreSQL preservation proof are part of this update.
