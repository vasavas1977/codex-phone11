# PBX readiness server-address comparison

The retained synthetic v3 observation failed only `serverMatch`; its raw address
and port subclauses were not independently recorded. The source compared an
`inet` value cast to `text` against a bare IPv4 configuration value. PostgreSQL
16 documents that this cast retains the netmask, whereas `host(inet)` returns the
address without the mask. See [the official network-function documentation](https://www.postgresql.org/docs/16/functions-net.html).

The query now compares `pg_catalog.host(pg_catalog.inet_server_addr())=$1` with
exact text equality and retains `inet_server_port()=5432`. Expected configuration
still accepts only bare IPv4; subnet, IPv6, host:port and whitespace inputs are
refused. Database/OID/version/schema, read-only RR, session/role flags, fresh
pre/post tenant-admin authority, decoder shape, timeouts and response privacy are
unchanged. A Unix-socket/null address remains unavailable, not a match.

`tests/phone11-pbx-readiness-address-postgres.test.ts` executes the exact product
query and decoder inside a rollback-only RR READ ONLY transaction using the
existing dedicated IPv4 loopback `PHONE11_PBX_TEST_DATABASE_URL` fixture on port
5432. The client connection's loopback target is not assumed to be PostgreSQL's
backend interface: Docker port publishing can terminate on a bridge address.
Within that same leased RR READ ONLY transaction, tests privately validate one
bare backend IPv4 and the fixed port, then derive the expected host, a guaranteed
different host, /32 and /8 inputs. Only decoded/fixed booleans are asserted or
returned; unknown metadata and measured address values are never logged. Four
required cases cover backend-address success (including the old cast's false
comparison), mismatched IP, /32 input and subnet input. They preserve the
product's fixed four parameters; `databaseMatch` is truthfully false on the
`phone11_pbx_test` database. They do not call app startup, grant roles, create
schema or access customer rows. The PG16 CI job runs this file and requires all
its assertions to execute with zero skips. Locally it skips when that dedicated
fixture is absent; offline config tests cover bare-address input rejection.

This source fix and its fixture checks do not prove production pool LOGIN,
restricted runtime privileges, writer/cutover compatibility, deployment or
provider/device acceptance. Retained v1/v2/v3 failed synthetic receipts stay
immutable. Any later synthetic v4 run requires its own committed-source binding,
reviewed helper and actual result; no result is inferred here.
