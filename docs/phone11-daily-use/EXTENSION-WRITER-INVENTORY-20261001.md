# Phone11 extension writer inventory — 1 October 2026

**Decision: keep the live `extensions.tenant_id DEFAULT 1` and the extension
tenant prerequisite uncommissioned.** This read-only snapshot identifies the
running local clients and the literal SQL in their packaged application
bundles. It does not bound dormant, external, or dynamically generated writes,
or prove rollback compatibility after removing the default.

## Target and connection evidence

The inspected target was `public.extensions` in the `phone11ai` database on
VoIP EC2 `i-0851dd1ea1cfeef71` (`ap-southeast-7a`), container
`cp11-postgres` (image ID
`sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50`).
At 2026-09-30 18:14 UTC, catalog and aggregate reads still showed an integer,
nullable `tenant_id` with default expression `1`, four extensions and zero
NULL tenant assignments. The connected database role was a superuser. No
customer rows, credentials, DSNs, or environment values were read out.

`pg_stat_activity` showed 27 idle sessions from bridge gateway `172.18.0.1`,
one from `172.18.0.4`, and one from `172.18.0.10`; all application names were
empty. Docker network inspection mapped `.4` to `cp11-backend` and `.10` to
`cp11-profile-photo-worker`. Host socket-owner inspection mapped the gateway
connections to the host-network `p11-kamailio` process (image ID
`sha256:f7c3a2412b49f1372c70b2ad06da6f28cb34a044ee3ae408c7b960ef484bb5b7`).
This attribution is a momentary socket observation, not an application-level
writer allowlist. Other running candidates had no direct session in that
snapshot, but can connect later; the database is published on host loopback
`127.0.0.1:5432`. A separate Kamailio connection to another database endpoint
was observed and was outside this target audit.

## Exact running application artifacts

The table records the Docker image ID and SHA-256 of `/app/dist/index.mjs`.
All 21 listed application/worker containers were running and the entire
`index.mjs` of each was scanned for literal `INSERT INTO extensions` column
lists, positional inserts, and `COPY extensions`. Every `index.mjs` had two
literal column-list inserts specifying `tenant_id`; none had a matching
literal positional insert or `COPY`. This bounded text scan does not establish
that dynamic SQL, another packaged file, a dormant job, or an external client
cannot write this table.

| Container | Image ID (`sha256:`) | `index.mjs` SHA-256 |
| --- | --- | --- |
| `cp11-backend` (3000 baseline; direct DB session) | `d42c70f34d5062bff779c235dd2b6e415bede3b3a86b9de73892acf35b392619` | `57e80ecaef64f32baf6d7195ab4f63316bb6ccc802b28d1bd2595878f3bef000` |
| `cp11-api-candidate-sip-consistency` (3016) | `920f21217b57750184ce546e47a6a9d93dd81787f74ff3bf76fb6faa905534c7` | `d489be90000d3cdc1c40088c6efb5048d65d44db6a3084ffebb9461ac87f682c` |
| `cp11-api-candidate-zoom-90d89b8` (3020) | `bf96778293b92d69e0bde9e647b239de96215269ab7b42e15f9a54ea324ddf8c` | `93b6769161196fd2e8089d08490870a6bf4de5375d94d87dab1aee0a7d2ea895` |
| `cp11-api-candidate-zoom-221252d` (3019) | `248bad56e5cb34c918c9f02f6a58c9f24ad64e6461b194becab2293d30ca058e` | `d93ccbc3ec9bcdb7fbde494d5556277d1cd23ff0450db4d0b6a64d0909f9282d` |
| `cp11-api-candidate-wake-local` (3018) | `6733cf0750e11954be168d7788e6083169c011af9892930337e355e926bf7b75` | `b858fac24422986940a51ff387011f17f2356ec6c26d76925fb0911a1ac04ba9` |
| `cp11-api-candidate-history-tenant` (3017) | `f0909b6f4c4ff41397f49e8337dc09ecb3ff88e597b75d630113d87b2f6e7521` | `4c65920d1aca2dc1035e6e136c843148c165f2d983a028a8ac4533ce90e2b06a` |
| `cp11-api-candidate-invitations-enabled` (3015) | `0942f8a6dd17f2919e6631adbc55318e2e8693ff9f869f90fa26d8327950b47d` | `f06dcd6044a4a8b50ec35571834d7f82170efdd1d86b7559a2e3315fddd416a2` |
| `cp11-api-candidate-invitations` (3014) | `0942f8a6dd17f2919e6631adbc55318e2e8693ff9f869f90fa26d8327950b47d` | `f06dcd6044a4a8b50ec35571834d7f82170efdd1d86b7559a2e3315fddd416a2` |
| `cp11-api-candidate-voicemail` (3013) | `a357b1b1003caa462ce96a0606a0c3406541056ce86d351e1f21912f55f622be` | `829c8b9a73d152cdc7df1dd57b1066960ddec223b33cdccfe89df7f8b6dfaeb3` |
| `cp11-api-candidate-status` (3012) | `99f21641e7eee91ff896b4eeeec3b6762835d1bd6992e693c56b7987dd2acb12` | `8781634006f914d9391de6f55d63973ac74e3d850074039132742a586bf92d9f` |
| `cp11-api-candidate-direct-meeting` (3011) | `c32a2a3a72061f2d4dbb8a54a1528666fd25003cd9782ae9de4ffa60c0e7d1b3` | `1f5abb9e19da7a6040d26634d64f8ea139049c61840884477afafc097ae14bbe` |
| `cp11-api-candidate-chat-inbox` (3010) | `55b593f0c392c67bc74589dcae4cb0e36b2f2e6dcd8a3552be781429ed0e2d77` | `75381c01555e1d924eddc2da2c97a1f1e44224dec5c4f03947518e24f6148b5b` |
| `cp11-api-candidate-meeting-title` (3009) | `c66d4e95e4177a75bb4a3c0c6a900de80c57f071b0b3d8d7daa45332404b2398` | `870fdad722679a67575a57c27fee5131c2128aa75d97d201064588c76cb0292e` |
| `cp11-api-candidate-meetings` (3008) | `d23a97bd859bb2788802fe50debc0d5551a1125d3b879d62277016f41fa0bd22` | `97770ec21c24ec80f235545ffd66371eb9dd8fd756444578a6af09a5640c2d3b` |
| `cp11-api-candidate-desktop-provisioning` (3007) | `b714cec08a15f6465baba58204a3473494e8c043bd3cef5323b5a35d676f6baa` | `8dda0429b527238d96e742f03e8c2f8b523247c705b5d3cf9350c0a57e699897` |
| `cp11-api-candidate-channel` (3006) | `62d8dd798e8bc08b939b75aa57761e1f14341fdbbdcdac7d3a04ae63a6e79dbd` | `a846c1c73ae3eeb55f4f4a60b3266981fad980ded33dc331c5ccd2dbb79f56c4` |
| `cp11-api-candidate-settings` (3005) | `2669c5032ebda82381c2e1f947cbd804132457355bb05931f1e921d064f1c8a9` | `a402622920fadd4fb7216452ac68b5d9c27e15ec804eedace25d255665442305` |
| `cp11-password-recovery` (3004) | `21b31746db0f22295ad5d944d530b2dec4bc70400619cf9e4381bb1011c0fa54` | `4d3630a668b4fa2d0538321509cd0beefcb6956baeef3c9cf7c163aa2c48bb22` |
| `cp11-api-candidate-next` (3003) | `2e7225e80ec7e5fac5d82c20f294372bbcf325116de9926f7dff5f2a9ee1f1a9` | `152de0d6d2c1fbb743e84227248aa101e044dcb1edb5bc1f347a380b484fc4a5` |
| `cp11-api-candidate` (3002) | `cfea5fb61b244bec980211aab4f9d27320f8fd5e2deec2c5d4ae89c3f0f16e91` | `0c3c4e2271485ad7ecdf2b9a1f2b81f45ab0c9abaec1050cd8ebaf80fa4ce472` |
| `cp11-profile-photo-worker` (direct DB session) | `88a3d8a1a98c5d4f68355bed1161eac1e16e1a663b5900bcef8a311e5279ac6a` | `a846c1c73ae3eeb55f4f4a60b3266981fad980ded33dc331c5ccd2dbb79f56c4` |

In the exact 3000, 3016, and 3020 bundles, the two lists correspond to the
PBX admin extension create and phone-provisioning create paths. The current
source passes the tenant context or `orgId` as the `tenant_id` parameter
(`server/pbx/pbx-router.ts`, `server/phone-provisioning.ts`); the bundle text
confirms the packaged column lists, not every runtime value or every possible
writer. Those three bundles also contain a legacy initializer declaring
`tenant_id INTEGER DEFAULT 1` in `CREATE TABLE IF NOT EXISTS extensions` and
`ADD COLUMN IF NOT EXISTS tenant_id INTEGER DEFAULT 1`. The latter only acts
when the column is absent; it does not restore a dropped default on the
existing column. It remains a fresh/partial-schema and rollback design
consideration. The 3016 container also retains a
`phone-provisioning-probe.mjs` with the initializer and an explicit-tenant
insert; its execution or future use was not established. Other packaged entry
points were not exhaustively assessed.

The live catalog has seven enabled noninternal triggers on `extensions`, no
non-`_RETURN` rules, and no non-system function definition with a literal
`INSERT INTO extensions` match. The three trigger function definitions had no
literal insert/update/copy against `extensions`; this textual check does not
rule out dynamic SQL or calls to other functions. Kamailio's local DB session
proves connectivity, not an extension writer or absence of one.

## Unclosed writer boundary and next step

Empty `application_name`, a shared superuser login, host-loopback access and
many retained live images prevent a complete principal-to-writer inventory.
No bound was established for external clients, scheduled/manual SQL, dormant
scripts, dynamic/ORM-generated queries, route changes, or exact rollback paths.
Therefore removing `DEFAULT 1` live could break an unknown writer, while
leaving it could silently assign tenant 1 to an omitted-tenant insert. Two
literal inserts per bundle are insufficient to resolve that tradeoff.

The smallest safe next step is to capture the approved active and rollback
route/image set and an authoritative inventory of every principal allowed to
write `public.extensions`, including host jobs and external access, without
exposing credentials. On a protected clone of the actual database, rehearse a
reviewed transaction that recognizes precisely the observed `DEFAULT 1`, drops
it, checks NULL/orphan assignments, and then performs the prerequisite
NOT NULL/FK change. Exercise both extension-create paths in each retained
rollback artifact and an omitted-tenant attempt, plus fresh/partial-schema
initializer behavior. Keep the live prerequisite's current no-default guard
and do no production migration until that writer and rollback boundary is
closed and independently reviewed.
