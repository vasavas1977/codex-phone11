from dataclasses import asdict, replace
import json
import unittest

from evidence import Held, MAX_SAMPLE_GAP_NS, RuntimeSample, RuntimeScope, StoreStatus, observe_stores

HEADER = b"sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n"
TCP4 = b"  0: 0100007F:A001 0200007F:1538 01 00:00 00:00 00 1000 0 101\n"
TCP6 = (
    b"  0: 00000000000000000000000001000000:A002 "
    b"00000000000000000000000002000000:1538 01 00:00 00:00 00 1000 0 102\n"
)
MAPPED_TCP6 = (
    b"  0: 0000000000000000FFFF00000100007F:A001 "
    b"0000000000000000FFFF00000200007F:1538 01 00:00 00:00 00 1000 0 101\n"
)
SCOPE = RuntimeScope((("127.0.0.2", 5432), ("::2", 5432)), 60, 100, frozenset({(7, 22)}))
HELD = Held("synthetic-private-runtime-token", True, 1_000)
LATER = replace(HELD, sampled_ns=2_000)


def pg_row(address, port, pid, role=100, tls=True):
    return dict(
        client_address=address, client_port=port, backend_pid=pid, database_oid=60,
        role_oid=role, tls=tls,
    )


def project(before):
    return observe_stores(before, replace(before, held=LATER), SCOPE)


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.before = RuntimeSample(
            HELD, HEADER + TCP4, HEADER + TCP6, "little", frozenset({101, 102, 103}),
            [
                pg_row("127.0.0.1", 0xA001, 701),
                pg_row("::1", 0xA002, 702, role=110, tls=False),
                pg_row(None, -1, 703, role=110, tls=False),
            ],
            ((103, 201, 703),),
            frozenset({(7, 22), (8, 22)}),
        )

    def test_distinguishes_ipv4_ipv6_unix_and_sqlite(self):
        result = project(self.before)
        self.assertEqual(result.status, StoreStatus.OBSERVED)
        self.assertEqual((result.postgres_tcp, result.postgres_unix, result.sqlite_files_open), (2, 1, 1))
        self.assertEqual((result.postgres_tls, result.postgres_legacy), (1, 1))
        self.assertFalse(result.live_qualified)
        self.assertFalse(result.dispatch_allowed)
        public = json.dumps(asdict(result))
        for private in ("private-runtime-token", "127.0.0.1", "::1", "701", "702", "703"):
            self.assertNotIn(private, public)

    def test_accepts_mapped_ipv6_and_big_endian_capture(self):
        first = replace(
            self.before, tcp4=HEADER, tcp6=HEADER + MAPPED_TCP6, unix_peers=(),
            sqlite_fds=frozenset(), pg_rows=[pg_row("::ffff:127.0.0.1", 0xA001, 701)],
        )
        self.assertEqual(project(first).postgres_tcp, 1)
        big_endian = replace(
            first, tcp4=HEADER + TCP4.replace(b"0100007F", b"7F000001").replace(b"0200007F", b"7F000002"),
            tcp6=HEADER, byteorder="big",
        )
        self.assertEqual(project(big_endian).postgres_tcp, 1)

    def test_unowned_tcp_is_never_attributed(self):
        first = replace(self.before, owned_sockets=frozenset({103}))
        self.assertEqual(project(first).postgres_tcp, 0)
        self.assertEqual(project(first).postgres_unix, 1)

    def test_refuses_shared_pg_source_even_with_unowned_socket(self):
        collision = TCP4.replace(b"0200007F:1538", b"0300007F:1538").replace(b"0 101", b"0 104")
        first = replace(self.before, tcp4=self.before.tcp4 + collision)
        scope = replace(SCOPE, pg_endpoints=(*SCOPE.pg_endpoints, ("127.0.0.3", 5432)))
        self.assertEqual(observe_stores(first, replace(first, held=LATER), scope).status, StoreStatus.UNKNOWN)

    def test_refuses_multiple_or_unmatched_backends(self):
        for rows in (
            [*self.before.pg_rows, pg_row("127.0.0.1", 0xA001, 704)],
            self.before.pg_rows[1:],
            [*self.before.pg_rows, pg_row("127.0.0.7", 6000, 701)],
            [dict(row, query="synthetic-private-query") for row in self.before.pg_rows],
        ):
            first = replace(self.before, pg_rows=rows)
            self.assertEqual(project(first).status, StoreStatus.UNKNOWN)

    def test_refuses_unix_path_only_wrong_backend_or_reused_peer(self):
        for peers in (
            (("/synthetic-private-pg.sock", 201, 703),),
            ((103, 201, 701),),
            ((103, 201, 703), (103, 202, 703)),
            ((103, 101, 703),),
        ):
            first = replace(self.before, unix_peers=peers)
            self.assertEqual(project(first).status, StoreStatus.UNKNOWN)

    def test_sqlite_requires_exact_device_and_inode_not_only_inode(self):
        first = RuntimeSample(
            HELD, HEADER, HEADER, "little", frozenset(), [], sqlite_fds=frozenset({(8, 22)})
        )
        self.assertEqual(project(first).status, StoreStatus.UNKNOWN)
        first = replace(first, sqlite_fds=frozenset({(7, 22)}))
        self.assertEqual(project(first).sqlite_files_open, 1)

    def test_idle_unproven_and_no_stable_match(self):
        empty = RuntimeSample(HELD, HEADER, HEADER, "little", frozenset(), [])
        self.assertEqual(project(empty).status, StoreStatus.UNKNOWN)
        for second in (
            self.before,
            replace(self.before, held=replace(LATER, complete=1)),
            replace(self.before, held=replace(LATER, sampled_ns=True)),
            replace(self.before, held=replace(LATER, sampled_ns=HELD.sampled_ns + MAX_SAMPLE_GAP_NS + 1)),
            replace(self.before, held=replace(LATER, identity="different-epoch")),
            replace(self.before, held=LATER, sqlite_fds=frozenset()),
            replace(self.before, held=LATER, pg_rows=[dict(row, role_oid=900) for row in self.before.pg_rows]),
        ):
            self.assertEqual(observe_stores(self.before, second, SCOPE).status, StoreStatus.UNKNOWN)

    def test_wrong_database_truncated_and_malformed_socket_data(self):
        for first in (
            replace(self.before, tcp4=self.before.tcp4.rstrip()),
            replace(self.before, tcp4=HEADER + TCP4.replace(b"0100007F", b"0100007Z")),
            replace(self.before, tcp4=HEADER + TCP4.replace(b"0 101", b"0 0")),
            replace(self.before, tcp4=HEADER + TCP4 * 10_000),
            replace(self.before, owned_sockets=frozenset({True})),
            replace(self.before, pg_rows=[dict(row, database_oid=99) for row in self.before.pg_rows]),
            replace(self.before, pg_rows=[dict(row, tls=1) for row in self.before.pg_rows]),
        ):
            self.assertEqual(project(first).status, StoreStatus.UNKNOWN)
