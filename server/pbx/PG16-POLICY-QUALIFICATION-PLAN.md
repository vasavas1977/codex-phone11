# Generated PostgreSQL 16.13 policy qualification

Prepared and executed 17 October 2026. Root owns every acquisition, build and database launch.
This plan does not authorize production access, provider calls, deployment or
physical-device testing. Historical PG17 55/55 and HTTP 12/12 receipts remain
historical; this qualification requires new pins and a new receipt.

## Read-only tool preflight

- Installed native PostgreSQL: `/opt/homebrew/Cellar/postgresql@17/17.11` only.
  No PostgreSQL16 installation appeared in `/opt/homebrew/opt`, Cellar, the
  Homebrew cache root/downloads or the Downloads directory root.
- Docker client 29.4.3 darwin/arm64 selected `desktop-linux`, whose endpoint is
  `unix:///Users/vasavas16macbookpro/.docker/run/docker.sock`, TLS-skip false.
  That socket was absent; engine version, engine resources and cached PG16
  images could not be inspected. No Docker engine was started.
- Existing Apple clang 17.0.0 targets arm64-apple-darwin24.6.0; GNU make 3.81,
  flex 2.6.4 and bison 2.3 are available. Xcode SDK contains `usr/include/zlib.h`
  and `usr/lib/libz.tbd`. Official release tarballs include generated parser
  files, so no parser regeneration is planned.
- The task volume had 18 GiB available at preflight. Recheck immediately before
  acquisition/build; this observation is not reserved capacity.

## Exact official source and private build

Official archive:
[postgresql-16.13.tar.bz2](https://ftp.postgresql.org/pub/source/v16.13/postgresql-16.13.tar.bz2)
(25,051,306 bytes). Its independently fetched official
[SHA256 file](https://ftp.postgresql.org/pub/source/v16.13/postgresql-16.13.tar.bz2.sha256)
contains:

```text
dc2ddbbd245c0265a689408e3d2f2f3f9ba2da96bd19318214b313cdd9797287  postgresql-16.13.tar.bz2
```

The official version directory lists checksums, with no detached signature.
No signature verification is claimed. Root should preserve the fetched checksum,
archive hash/size, HTTPS source URLs and build logs in an exclusive receipt.

Create this NEW task directory with mode 0700; refuse reuse/symlink targets:

```text
/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/review/pg16-policy-qualification-20261017-v1/toolchain
```

Use `source/`, an out-of-tree `build/`, and `install/` beneath it. Download with
`/usr/bin/curl` in a scrubbed environment, HTTPS-only, bounded connect/total time
and exact expected archive size. Verify the pinned SHA256 and size before
extracting; reject absolute/traversing archive members or escaping links.
No package manager, sudo, service registration or existing prefix is involved.

From the new `build/`, use the extracted official `configure` script:

```text
--prefix=/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/review/pg16-policy-qualification-20261017-v1/toolchain/install
--without-readline
--without-icu
```

Use a fresh environment (`PATH=/usr/bin:/bin:/usr/sbin:/sbin`, `TZ=UTC`,
`LC_ALL=C`, `CC=/usr/bin/clang`, optional explicit Xcode `SDKROOT`), then
`/usr/bin/make -j2` and `/usr/bin/make install` into that private prefix.
Keep the default zlib support. Suggested bounds: configure 120s, build 900s,
install 120s; at most two compiler jobs. Estimates, not measurements: up to 2 GiB
retained disk and 1 GiB peak build memory. Stop on failure or unexpected resource
pressure, preserving logs; do not retry by installing dependencies or disabling
features. Do not run `make check`: it starts clusters and requires a distinct
Root launch decision.

Inspect and retain `postgres --version`, `pg_config --version`,
`pg_config --configure`, linked libraries, and exact tool/libpq hashes before
preparing the qualification manifest. The launcher asserts version 16.13 and the
exact prefix/feature options. No acquisition/build has been executed by the
source-preparation worker.

Feature limits: readline only affects interactive psql editing/history. ICU is
disabled, so this tests C/libc locale with `initdb --no-locale`, not ICU behavior.
OpenSSL/TLS is not enabled; the generated TCP connection is loopback with
`ssl:false` and SCRAM passwords. This qualifies matching16.13 SQL/catalog,
restricted-LOGIN and application behavior on macOS, not Linux/TLS/collation
production parity. Zlib remains enabled so the private PG16 tools can support
compressed custom backup archives in a separate authorized restore lane.

[Official build procedure](https://www.postgresql.org/docs/16/install-make.html)
and [build requirements](https://www.postgresql.org/docs/16/install-requirements.html)
document these options and the release-tarball prerequisites.

## Source and execution contract

`scripts/phone11-pg16-policy-qualification.py` is plan-only by default. Root's
explicit `--run-isolated-generated-pg16` invocation requires an externally supplied
SHA256 of a fresh manifest, with these fields:

- `kind=PHONE11_GENERATED_PG16_QUALIFICATION_SOURCE`, exact checkout `root`;
- `qualificationScope=pg16-storage-handlers-http`, `postgresVersion=16.13` and
  `sourceTarballSha256` equal to the official digest above;
- exact `source` entries from `SOURCES + HTTP_SOURCES`, exact `tools` entries
  from `TOOLS + LIBRARIES`, and exact `dependencies` entries from
  `DEPENDENCIES + HTTP_DEPENDENCIES`. Each pin is `{sha256,bytes}`.

The source includes all actual migration SQL, dedicated fraud adapter, router,
audit/helper use, real authentication sources, five test files, package/lock and
Vitest configuration. Selected installed entrypoints of the matching dependency
donor are pinned; the donor package, lock and Vitest configuration must match.
Any app `.env*` file other than `.env.example`, pre-existing `node_modules`,
source drift, wrong version/features, wrong target/scope, or missing pin refuses
before cluster effects. No configured app environment is loaded.

An approved run creates one private `/tmp/p11-policy-pg16-*` directory, one new
cluster on `127.0.0.1:55436` plus a private Unix socket, database
`phone11_pbx_test`, and a generated operator password. The binary and queried
server both must identify 16.13 (`server_version_num=160013`). PostgreSQL is a
retained foreground child, with eight connections, 16 MiB shared buffers,
no parallel/background workers, 32–64 MiB WAL bounds and generated data only.
A new owned `node_modules` symlink is verified by target/device/inode/uid during
cleanup; an unexpected replacement is preserved and makes the run unsuccessful.

Run exactly these five test files serially with one threaded Vitest worker,
a 256 MiB Node old-space cap and a 180s timeout:

1. `tests/phone11-fraud-controls-migration.test.ts`
2. `tests/phone11-audit-storage-migration.test.ts`
3. `tests/phone11-audit-runtime-permissions.test.ts`
4. `tests/phone11-fraud-policy-native-api.test.ts`
5. `tests/phone11-fraud-policy-http.test.ts`

The selected suites require 67 passed, 0 failed and 0 pending tests; partial/skipped
success is rejected. Runtime permission and API/HTTP paths use genuine new
restricted LOGIN connections, never setup-session `SET ROLE` as evidence. SQL
setup uses its separately generated operator. The HTTP suite accepts only the
test-only `PHONE11_PBX_TEST_SERVER_MAJOR=16|17` (default17), with the existing
strict generated loopback/port/database/operator gate intact. All 67 run against
PG16 with the variable set 16. The suite owns one ephemeral loopback HTTP listener
inside the directly owned Node process. Shared fraud pool/DML access remains
forbidden by the existing test transport assertions.

The Node/test environment is built from a fixed minimal dictionary; no inherited
`PG*`, app DB, auth, cloud, proxy or provider environment falls back. Source,
toolchain and selected donor pins must remain stable after tests. Finally, signal
only the retained unreaped PostgreSQL child with SIGINT and wait 15s; do not kill
process groups, discover PID files or touch unrelated servers. On uncertain stop,
preserve everything and report failure without a blind retry. Retain data/logs
and create an exclusive 0400 receipt with artifact hashes and print its SHA256.
The receipt is sealed against accidental writes; it is not a tamper-proof
external ledger. Root retains its digest in the review packet.

## Source-preparation validation and remaining gates

`tests/phone11_pg16_policy_qualification_test.py` passed 11/11 inert guard/fault
checks without PostgreSQL, Node, sockets or cluster creation. This covers
plan-only behavior, root/external-pin refusal, historical/partial manifest
rejection, exact patch/features, source scope, unchanged HTTP target bounds,
owned shutdown faults and exclusive read-only receipt custody.

Root completed the private official-source build and independently reviewed all
31 source, 11 tool/library and 16 selected dependency pins. The exact qualification
manifest SHA256 is
`30c99b930b2e1d6a6f1d0da853c4519b6a6af29ea44cabaf6af8e2d8c25527af`.
The generated run passed **67/67**, zero failed or pending, on queried version
`160013`. The owned PostgreSQL and test processes exited 0, the temporary
dependency link was removed, and all pinned inputs remained stable.

Receipt: `/private/tmp/p11-policy-pg16-siwh3wsn/receipt.json`, SHA256
`99e7c9b4c9d5c35da535f6202902415ab16f7232501d15d5d968aba8ddef2aab`.
An independent review verified its test totals and four artifact hashes.
The retained operator result is
`work/phone11-publish-pbx-20261014/review/pbx-pg16-commissioning-20261017-v1/PG16-QUALIFICATION-RESULT-v1.json`
under the Super Number workspace. No `make check` or production database was used.

This generated macOS/C-locale result does not prove production backup/restore,
live restricted-role admission, deployed Linux/TLS/ICU behavior or routing,
provider calls, billing behavior, Android or phone acceptance. Those remain
separate gates; Android and phone testing are deferred by the owner.
