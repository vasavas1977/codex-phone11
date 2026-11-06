# Phone11 passive SIP database evidence

This Python standard-library package classifies explicitly supplied, already held
evidence. It has no collector, CLI, path reader, network client, SQL execution,
or runtime controls. Import the modules from this directory and keep inputs in
private memory. Only the classifier results are suitable for a sanitized report.
The results always carry `live_qualified=False` and `dispatch_allowed=False`.

| Classifier | Input | Result |
| --- | --- | --- |
| `classify_kamailio` | Two held projections of the effective `db_url` and active/inactive database mode for each of `auth_db`, `usrloc`, `dispatcher`, `dialog`, `presence` and `presence_xml` | Six fixed module labels with configured legacy, configured restricted, other PostgreSQL, explicitly inactive, or unknown selections |
| `classify_freeswitch` | Two identical, held, already expanded UTF-8 `freeswitch/xml` documents | Core selection and aggregate Sofia profile selection counts. No profile names or DSN material |
| `observe_stores` | Two held process-family/socket/FD/PG projections | Stable positive counts of PostgreSQL TCP, PostgreSQL Unix, TLS, legacy role, and independently identified SQLite files held open |

Use two fresh, independently captured samples from the same monotonic clock,
at most 30 seconds apart. The caller must independently establish custody and
completeness before setting `Held.complete`. Its private identity token must
bind the exact image/executable and module builds, startup epoch and process
family, relevant mount and network namespaces, selected effective configuration
generation, and target database cluster where applicable. The token is opaque
to this library. Do not supply a repo template, an image tag alone, a regenerated
file, or the same capture twice as runtime evidence. The library cannot verify
that an attestation is true, that a capture is currently fresh, or that two
snapshots describe the interval between them.

For Kamailio the caller must independently resolve the actual launch config,
include and macro closure, module defaults, mode, and any environment or
runtime override against the held executable. An inactive label needs positive
mode evidence. An absent pool cannot supply it. The parser accepts a bounded
literal `postgres://` URI with explicit endpoint, database and role. Supply a private expected target for each of the six modules, so
using another module's restricted role cannot count as the expected selection.
For an exact DB1 build proven to use libpq `expand_dbname=1`, it also recognizes the
bounded `dbname=... hostaddr=...` database-field shape when both snapshots
carry that build attestation and the numeric address is independently pinned. Query-bearing Kamailio URIs remain unknown because
DB1 builds may discard the query suffix. It has no general Kamailio parser.
A shared DB1 connection can establish process-family attribution only.

For FreeSWITCH the caller must bind the expanded document to configuration
actually selected at startup and any later override. A current on-disk
`.fsxml` alone cannot establish that relationship. The classifier covers
`switch.conf` core settings, `post_load_switch.conf` core settings when
present, and Sofia profile `odbc-dsn` settings. It accepts a narrow literal
`postgresql://` URI or `pgsql://` keyword DSN with an explicit endpoint, database
and role. It does not interpret preprocessor directives, include files, XML
bindings, ODBC aliases, other modules, or defaults. Conflicting core settings,
ambiguous XML, dynamic material, unsupported DSNs and missing values stay
unknown. Module load alone, including `mod_pgsql`, supplies no backing-store
proof. The target class compares configured literals with a caller-supplied
target. It cannot prove resolution, server identity, trust verification,
privileges, successful connection, or per-profile runtime use.

For PostgreSQL TCP the caller must supply the complete held Linux IPv4 and
IPv6 tables, capture byte order, process-family owned socket inodes, and
approved direct server endpoints. The fixed PG projection has
`client_address`, `client_port`, `backend_pid`, `database_oid`, `role_oid` and
`tls` only. Independently verify that the readback covers the pinned cluster
with complete relevant session visibility and without proxy or NAT translation.
The classifier joins an owned established client tuple to a unique backend in
that cluster and compares positive matches across samples. For Unix sockets,
each private tuple is `(client_socket_inode, server_socket_inode, backend_pid)`.
The caller must independently establish the connected peer pair and the held
server-side backend FD, not just the socket pathname. A Unix PG row has null
`client_address`, `client_port=-1` and `tls=False`. For SQLite, the caller must
identify each approved regular backing file as SQLite independently and match
its held `(device, inode)` to an actual actor FD. The classifier reads no
database contents. An open SQLite file alone cannot identify a module or prove
the core's selected store. A positive store result can include several stores
at once. An unknown result has placeholder zero counts, which cannot support
an absence claim. A TLS count describes the sampled server observation and
cannot establish client hostname or CA verification.

Before live qualification, obtain the exact, provenance-reviewed FreeSWITCH
artifact and separately verify effective FreeSWITCH backing stores and every
Kamailio binding, including other loaded consumers, in a custody-reviewed
readback. Rehearse actual startup, restricted-role grants, TLS success and
failure, admission and drain behavior, and rollback on exact artifacts with
synthetic data. Any later legacy LOGIN retirement also requires all consumer
and independent maintenance/admin paths to be verified separately. This
package performs none of those actions and has no production acceptance
result. It does not change the 60-second calling trial or exercise phones,
Android or providers.

Run the synthetic tests from the repository root:

~~~sh
python3 -B -m unittest discover -s scripts/phone11-sip-migration -p 'test_*.py'
~~~
