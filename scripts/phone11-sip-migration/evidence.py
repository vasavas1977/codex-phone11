"""In-memory attribution over explicit held evidence. There is no collector."""
from collections import defaultdict
from dataclasses import dataclass, field
from enum import Enum
import ipaddress
import re

MAX_TCP_BYTES = 512 * 1024
MAX_SOCKETS = 4096
MAX_SESSIONS = 512
MAX_ENDPOINTS = 32
MAX_FILES = 128
MAX_SAMPLE_GAP_NS = 30_000_000_000
UINT64 = 2**64 - 1
HEX = re.compile(r"[0-9A-Fa-f]+\Z")
DECIMAL = re.compile(r"[0-9]{1,20}\Z")


@dataclass(frozen=True)
class Held:
    """Caller-verified identity of an exact image, process and evidence scope."""
    identity: str = field(repr=False)
    complete: bool
    sampled_ns: int = field(repr=False)


def same_held(before, after):
    return (
        type(before) is Held
        and type(after) is Held
        and before.complete is True
        and after.complete is True
        and type(before.identity) is str
        and type(after.identity) is str
        and 0 < len(before.identity) <= 256
        and before.identity == after.identity
        and _uint(before.sampled_ns)
        and _uint(after.sampled_ns)
        and 0 < after.sampled_ns - before.sampled_ns <= MAX_SAMPLE_GAP_NS
    )


@dataclass(frozen=True, repr=False)
class Flow:
    source: tuple[str, int]
    destination: tuple[str, int]
    inode: int


@dataclass(frozen=True, repr=False)
class Session:
    source: tuple[str, int] | None
    backend_pid: int
    database_oid: int
    role_oid: int
    tls: bool


@dataclass(frozen=True, repr=False)
class RuntimeSample:
    held: Held
    tcp4: bytes
    tcp6: bytes
    byteorder: str
    owned_sockets: frozenset[int]
    pg_rows: list
    # Complete connected Unix peer pairs for the approved PG scope only. The
    # backend endpoint must be independently held as an FD of that backend.
    unix_peers: tuple[tuple[int, int, int], ...] = ()
    sqlite_fds: frozenset[tuple[int, int]] = frozenset()


@dataclass(frozen=True, repr=False)
class RuntimeScope:
    # Endpoints are the exact PG targets in the caller's captured network
    # namespace. The caller also pins the SQL cluster and database identity.
    pg_endpoints: tuple[tuple[str, int], ...]
    database_oid: int
    legacy_oid: int
    sqlite_files: frozenset[tuple[int, int]] = frozenset()


class StoreStatus(str, Enum):
    UNKNOWN = "unknown"
    OBSERVED = "observed"


@dataclass(frozen=True)
class StoreObservation:
    status: StoreStatus = StoreStatus.UNKNOWN
    postgres_tcp: int = 0
    postgres_unix: int = 0
    postgres_tls: int = 0
    postgres_legacy: int = 0
    sqlite_files_open: int = 0
    live_qualified: bool = field(default=False, init=False)
    dispatch_allowed: bool = field(default=False, init=False)


def _refuse():
    raise ValueError("INVALID_HELD_EVIDENCE") from None


def _uint(value, maximum=UINT64, minimum=1):
    return type(value) is int and minimum <= value <= maximum


def _ip(value):
    if type(value) is not str or not 0 < len(value) <= 45 or "%" in value:
        _refuse()
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        _refuse()
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    return str(address)


def _proc_endpoint(value, bits, byteorder):
    address, separator, port = value.partition(":")
    if (
        not separator or len(address) != bits // 4 or len(port) != 4
        or not HEX.fullmatch(address) or not HEX.fullmatch(port)
    ):
        _refuse()
    raw = bytes.fromhex(address)
    if byteorder == "little":
        raw = b"".join(raw[offset:offset + 4][::-1] for offset in range(0, len(raw), 4))
    number = int(port, 16)
    if number == 0:
        _refuse()
    return _ip(str(ipaddress.ip_address(raw))), number


def _parse_established(raw, bits, byteorder):
    """Return private tuples from one bounded Linux proc TCP table."""
    if (
        type(raw) is not bytes or len(raw) > MAX_TCP_BYTES
        or type(bits) is not int or bits not in (32, 128)
        or type(byteorder) is not str or byteorder not in ("little", "big")
        or not raw.endswith(b"\n")
    ):
        _refuse()
    try:
        lines = raw.decode("ascii").splitlines()
    except UnicodeDecodeError:
        _refuse()
    if not lines or len(lines) > MAX_SOCKETS + 1 or lines[0].split()[:4] not in (
        ["sl", "local_address", "rem_address", "st"],
        ["sl", "local_address", "remote_address", "st"],
    ):
        _refuse()

    flows = []
    for line in lines[1:]:
        fields = line.split()
        if (
            len(fields) < 10 or not fields[0].endswith(":")
            or not DECIMAL.fullmatch(fields[0][:-1])
            or len(fields[3]) != 2 or not HEX.fullmatch(fields[3])
        ):
            _refuse()
        if fields[3] != "01":
            continue
        if not DECIMAL.fullmatch(fields[9]) or not _uint(int(fields[9])):
            _refuse()
        flows.append(Flow(
            _proc_endpoint(fields[1], bits, byteorder),
            _proc_endpoint(fields[2], bits, byteorder),
            int(fields[9]),
        ))
    return tuple(flows)


def _parse_sessions(rows):
    """Accept only the fixed PG metadata projection. Tuples stay private."""
    fields = {"client_address", "client_port", "backend_pid", "database_oid", "role_oid", "tls"}
    if type(rows) is not list or len(rows) > MAX_SESSIONS:
        _refuse()

    sessions = {}
    for row in rows:
        if type(row) is not dict or set(row) != fields or type(row["tls"]) is not bool:
            _refuse()
        pid = row["backend_pid"]
        if (
            not _uint(pid, 2**31 - 1) or pid in sessions
            or not _uint(row["database_oid"], 2**32 - 1)
            or not _uint(row["role_oid"], 2**32 - 1)
        ):
            _refuse()

        address, port = row["client_address"], row["client_port"]
        if address is None:
            if type(port) is not int or port != -1 or row["tls"]:
                _refuse()
            source = None
        else:
            if not _uint(port, 65535):
                _refuse()
            source = _ip(address), port
        sessions[pid] = Session(source, pid, row["database_oid"], row["role_oid"], row["tls"])
    return sessions


def _file_keys(values):
    if type(values) is not frozenset or len(values) > MAX_FILES:
        _refuse()
    for key in values:
        if (
            type(key) is not tuple or len(key) != 2
            or not _uint(key[0], minimum=0) or not _uint(key[1])
        ):
            _refuse()
    return values


def _scope_endpoints(scope):
    if (
        type(scope) is not RuntimeScope or type(scope.pg_endpoints) is not tuple
        or len(scope.pg_endpoints) > MAX_ENDPOINTS
        or not _uint(scope.database_oid, 2**32 - 1)
        or not _uint(scope.legacy_oid, 2**32 - 1)
    ):
        _refuse()
    endpoints = set()
    for endpoint in scope.pg_endpoints:
        if type(endpoint) is not tuple or len(endpoint) != 2 or not _uint(endpoint[1], 65535):
            _refuse()
        endpoints.add((_ip(endpoint[0]), endpoint[1]))
    if len(endpoints) != len(scope.pg_endpoints):
        _refuse()
    return endpoints


def _matches(sample, scope, endpoints):
    if (
        type(sample.owned_sockets) is not frozenset or len(sample.owned_sockets) > MAX_SOCKETS
        or any(not _uint(inode) for inode in sample.owned_sockets)
        or type(sample.unix_peers) is not tuple or len(sample.unix_peers) > MAX_SOCKETS
    ):
        _refuse()
    flows = (
        *_parse_established(sample.tcp4, 32, sample.byteorder),
        *_parse_established(sample.tcp6, 128, sample.byteorder),
    )
    flow_inodes = {flow.inode for flow in flows}
    if len(flow_inodes) != len(flows):
        _refuse()

    sessions = _parse_sessions(sample.pg_rows)
    by_source = defaultdict(list)
    for session in sessions.values():
        if session.source is not None:
            by_source[session.source].append(session)

    scope_flows = defaultdict(list)
    for flow in flows:
        if flow.destination in endpoints:
            scope_flows[flow.source].append(flow)

    tcp_matches = {}
    unix_matches = {}
    matched_pids = set()
    for flow in flows:
        if flow.inode not in sample.owned_sockets or flow.destination not in endpoints:
            continue
        candidates = by_source[flow.source]
        if len(candidates) != 1 or len(scope_flows[flow.source]) != 1:
            _refuse()
        session, = candidates
        if session.backend_pid in matched_pids or session.database_oid != scope.database_oid:
            _refuse()
        matched_pids.add(session.backend_pid)
        tcp_matches[flow] = session

    unix_inodes = set()
    for peer in sample.unix_peers:
        if type(peer) is not tuple or len(peer) != 3:
            _refuse()
        client, server, pid = peer
        if (
            not all(_uint(value) for value in peer) or client == server
            or client not in sample.owned_sockets or server in sample.owned_sockets
            or client in unix_inodes or server in unix_inodes
            or client in flow_inodes or server in flow_inodes or pid in matched_pids
        ):
            _refuse()
        session = sessions.get(pid)
        if session is None or session.source is not None or session.database_oid != scope.database_oid:
            _refuse()
        unix_inodes.update((client, server))
        matched_pids.add(pid)
        unix_matches[peer] = session

    return tcp_matches, unix_matches, _file_keys(sample.sqlite_fds) & _file_keys(scope.sqlite_files)


def observe_stores(before, after, scope):
    """Project stable positive matches only. Zero matches never establish a store."""
    if (
        type(before) is not RuntimeSample or type(after) is not RuntimeSample
        or not same_held(before.held, after.held)
        or type(before.byteorder) is not str or type(after.byteorder) is not str
        or before.byteorder != after.byteorder
    ):
        return StoreObservation()
    try:
        endpoints = _scope_endpoints(scope)
        first = _matches(before, scope, endpoints)
        second = _matches(after, scope, endpoints)
    except ValueError:
        return StoreObservation()

    if first != second or not any(first):
        return StoreObservation()
    tcp, unix, sqlite = first
    sessions = (*tcp.values(), *unix.values())
    return StoreObservation(
        StoreStatus.OBSERVED, len(tcp), len(unix), sum(row.tls for row in sessions),
        sum(row.role_oid == scope.legacy_oid for row in sessions), len(sqlite),
    )
