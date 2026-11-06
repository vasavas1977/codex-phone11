"""Bounded classification of held effective configuration, never a preprocessor."""
from dataclasses import dataclass, field
from enum import Enum
import ipaddress
import re
from urllib.parse import parse_qsl, unquote, urlsplit
import xml.etree.ElementTree as ET

from evidence import Held, same_held

KAM_MODULES = ("auth_db", "usrloc", "dispatcher", "dialog", "presence", "presence_xml")
MAX_DSN = 4096
MAX_XML = 512 * 1024
MAX_XML_NODES = 8192
MAX_XML_DEPTH = 32
MAX_PROFILES = 64
ATOM = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}\Z")
HOST_LABEL = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\Z")
PORT = re.compile(r"[0-9]{1,5}\Z")
URI_ENDPOINT = re.compile(r"(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+):([0-9]{1,5})\Z")
URI_USERINFO = re.compile(r"[A-Za-z0-9_.~%+-]+(?::[A-Za-z0-9_.~%+-]*)?\Z")
BAD_PERCENT = re.compile(r"%(?![0-9A-Fa-f]{2})")
PG_PARAMETER = re.compile(r"([a-z_]+)=(?:'([^'\\]*)'|([^\s'\\]+))(?=\s|\Z)")
PG_OPTIONS = frozenset({
    "sslmode", "sslrootcert", "connect_timeout", "application_name", "channel_binding",
    "gssencmode", "ssl_min_protocol_version", "passfile", "options",
})
OPTION_ENUMS = {
    "sslmode": {"disable", "allow", "prefer", "require", "verify-ca", "verify-full"},
    "channel_binding": {"disable", "prefer", "require"},
    "gssencmode": {"disable", "prefer", "require"},
    "ssl_min_protocol_version": {"TLSv1", "TLSv1.1", "TLSv1.2", "TLSv1.3"},
}
DYNAMIC = ("$" + "{", "$(", "$env(", "$var(", "{{", "#!", "X-PRE-PROCESS")


class Selection(str, Enum):
    UNKNOWN = "unknown"
    INACTIVE = "inactive"
    LEGACY = "postgres_legacy_configured"
    RESTRICTED = "postgres_restricted_configured"
    OTHER = "postgres_other_configured"


@dataclass(frozen=True, repr=False)
class PgTarget:
    host: str
    port: int
    database: str
    legacy_role: str
    restricted_role: str
    hostaddrs: tuple[str, ...] = ()


@dataclass(frozen=True, repr=False)
class KamBinding:
    module: str
    mode: str
    db_url: str | None


@dataclass(frozen=True, repr=False)
class KamSample:
    held: Held
    bindings: tuple[KamBinding, ...]
    db1_expands_dbname: bool = False


@dataclass(frozen=True)
class KamConfiguration:
    bindings: tuple[tuple[str, Selection], ...] = tuple(
        (module, Selection.UNKNOWN) for module in KAM_MODULES
    )
    live_qualified: bool = field(default=False, init=False)
    dispatch_allowed: bool = field(default=False, init=False)


@dataclass(frozen=True, repr=False)
class FsSample:
    held: Held
    expanded_xml: bytes


@dataclass(frozen=True)
class FsConfiguration:
    core: Selection = Selection.UNKNOWN
    # Only Sofia settings in this held projection. No profile names or DSNs.
    sofia_profiles: int = 0
    sofia_legacy: int = 0
    sofia_restricted: int = 0
    sofia_other: int = 0
    sofia_unknown: int = 0
    live_qualified: bool = field(default=False, init=False)
    dispatch_allowed: bool = field(default=False, init=False)


def _invalid():
    raise ValueError("INVALID_EFFECTIVE_EVIDENCE") from None


def _atom(value):
    if type(value) is not str or len(value) > 128 or not ATOM.fullmatch(value):
        _invalid()
    return value


def _host(value):
    if type(value) is not str or not 0 < len(value) <= 253 or "%" in value:
        _invalid()
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        if (
            all(char.isdigit() or char == "." for char in value)
            or not all(HOST_LABEL.fullmatch(label) for label in value.split("."))
        ):
            _invalid()
        return value.lower()


def _target(value):
    if (
        type(value) is not PgTarget or type(value.port) is not int
        or not 1 <= value.port <= 65535
    ):
        _invalid()
    if type(value.hostaddrs) is not tuple or len(value.hostaddrs) > 16:
        _invalid()
    hostaddrs = frozenset(_hostaddr(address) for address in value.hostaddrs)
    legacy, restricted = _atom(value.legacy_role), _atom(value.restricted_role)
    if len(hostaddrs) != len(value.hostaddrs) or legacy == restricted:
        _invalid()
    return (
        _host(value.host), value.port, _atom(value.database),
        legacy, restricted, hostaddrs,
    )


def _hostaddr(value):
    if type(value) is not str or not 0 < len(value) <= 45 or "%" in value:
        _invalid()
    return str(ipaddress.ip_address(value))


def _dsn_text(value):
    if (
        type(value) is not str or not 0 < len(value) <= MAX_DSN
        or not value.isascii() or any(ord(char) < 32 or ord(char) == 127 for char in value)
        or any(token in value for token in DYNAMIC)
    ):
        _invalid()
    return value


def _uri(dsn, scheme):
    if "#" in dsn or BAD_PERCENT.search(dsn):
        _invalid()
    parsed = urlsplit(dsn)
    userinfo, at, endpoint = parsed.netloc.partition("@")
    if (
        parsed.scheme != scheme or not at or not URI_USERINFO.fullmatch(userinfo)
        or not URI_ENDPOINT.fullmatch(endpoint) or not parsed.hostname
        or not parsed.username or not parsed.path.startswith("/") or not parsed.port
    ):
        _invalid()
    return parsed


def _postgresql(dsn):
    if " " in dsn:
        _invalid()
    _dsn_text(unquote(dsn, errors="strict"))
    parsed = _uri(dsn, "postgresql")
    query = parse_qsl(parsed.query, strict_parsing=True, errors="strict", max_num_fields=8)
    keys = {key for key, _ in query}
    if len(keys) != len(query) or keys - PG_OPTIONS:
        _invalid()
    _options(dict(query))
    return (
        _host(parsed.hostname), parsed.port, _atom(unquote(parsed.path[1:], errors="strict")),
        _atom(unquote(parsed.username, errors="strict")), None,
    )


def _options(values):
    for key in PG_OPTIONS & values.keys():
        value = _dsn_text(values[key])
        if key in OPTION_ENUMS and value not in OPTION_ENUMS[key]:
            _invalid()
        if key == "connect_timeout" and (
            not PORT.fullmatch(value) or int(value) == 0
        ):
            _invalid()


def _conninfo(text, allowed):
    # Supported subset of libpq keyword conninfo. Reject duplicate or
    # unrecognized keys, escapes and service aliases.
    remaining = text.strip()
    values = {}
    while remaining:
        match = PG_PARAMETER.match(remaining)
        if match is None:
            _invalid()
        key, quoted, unquoted = match.groups()
        if key not in allowed or key in values:
            _invalid()
        values[key] = quoted if quoted is not None else unquoted
        remaining = remaining[match.end():].lstrip()
    _options(values)
    return values


def _pgsql(dsn):
    allowed = PG_OPTIONS | {"host", "hostaddr", "port", "dbname", "user", "password"}
    values = _conninfo(dsn.removeprefix("pgsql://"), allowed)
    if not ({"host", "hostaddr"} & values.keys()) or not {"port", "dbname", "user"} <= values.keys():
        _invalid()
    port = values["port"]
    if not PORT.fullmatch(port) or not 1 <= int(port) <= 65535:
        _invalid()
    hostaddr = _hostaddr(values["hostaddr"]) if "hostaddr" in values else None
    host = _host(values["host"]) if "host" in values else hostaddr
    return host, int(port), _atom(values["dbname"]), _atom(values["user"]), hostaddr


def _kam_db1(dsn, expands_dbname):
    # The qualified DB1 path passes its database field to libpq with
    # expand_dbname=1. Restrict keyword routing to dbname and numeric hostaddr.
    # Do not interpret URI query options as effective DB1 connection options.
    if "?" in dsn or "%" in dsn:
        _invalid()
    parsed = _uri(dsn, "postgres")
    path = parsed.path[1:]
    hostaddr = None
    if path.startswith("dbname="):
        if not expands_dbname:
            _invalid()
        options = _conninfo(path, PG_OPTIONS | {"dbname", "hostaddr"})
        if "hostaddr" not in options:
            _invalid()
        hostaddr = _hostaddr(options["hostaddr"])
        path = options["dbname"]
    return _host(parsed.hostname), parsed.port, _atom(path), _atom(parsed.username), hostaddr


def _selection(value, target, *, freeswitch=False, expands_dbname=False):
    try:
        dsn = _dsn_text(value)
        if not freeswitch:
            host, port, database, role, hostaddr = _kam_db1(dsn, expands_dbname)
        elif dsn.startswith("pgsql://"):
            host, port, database, role, hostaddr = _pgsql(dsn)
        else:
            host, port, database, role, hostaddr = _postgresql(dsn)
    except ValueError:
        return Selection.UNKNOWN

    target_host, target_port, target_db, legacy, restricted, target_addrs = target
    if (host, port, database) == (target_host, target_port, target_db):
        if hostaddr is not None and hostaddr != target_host and hostaddr not in target_addrs:
            return Selection.UNKNOWN
        if role == legacy:
            return Selection.LEGACY
        if role == restricted:
            return Selection.RESTRICTED
    return Selection.OTHER


def _kam_values(sample):
    if type(sample.bindings) is not tuple or len(sample.bindings) != len(KAM_MODULES):
        _invalid()
    bindings = {}
    for entry in sample.bindings:
        if (
            type(entry) is not KamBinding or type(entry.module) is not str
            or entry.module not in KAM_MODULES or entry.module in bindings
            or type(entry.mode) is not str or entry.mode not in ("active", "inactive")
            or (entry.mode == "inactive" and entry.db_url is not None)
        ):
            _invalid()
        if entry.mode == "active":
            _dsn_text(entry.db_url)
        bindings[entry.module] = (entry.mode, entry.db_url)
    return bindings


def classify_kamailio(before, after, module_targets):
    """Classify all six independently attested effective module declarations."""
    if (
        type(before) is not KamSample or type(after) is not KamSample
        or not same_held(before.held, after.held)
        or type(before.db1_expands_dbname) is not bool or type(after.db1_expands_dbname) is not bool
        or before.db1_expands_dbname != after.db1_expands_dbname
        or type(module_targets) is not dict or len(module_targets) != len(KAM_MODULES)
        or set(module_targets) != set(KAM_MODULES)
    ):
        return KamConfiguration()
    try:
        targets = {module: _target(module_targets[module]) for module in KAM_MODULES}
        values = _kam_values(before)
        if values != _kam_values(after):
            return KamConfiguration()
    except ValueError:
        return KamConfiguration()

    result = []
    for module in KAM_MODULES:
        mode, dsn = values[module]
        selection = (
            Selection.INACTIVE if mode == "inactive"
            else _selection(dsn, targets[module], expands_dbname=before.db1_expands_dbname)
        )
        result.append((module, selection))
    return KamConfiguration(tuple(result))


def _document(raw):
    if type(raw) is not bytes or not 0 < len(raw) <= MAX_XML:
        _invalid()
    text = raw.decode("utf-8")
    if re.search(r"<!\s*(?:DOCTYPE|ENTITY)", text, re.IGNORECASE):
        _invalid()
    # Accept a UTF-8 XML declaration, but no processing instructions.
    text = re.sub(
        r"""\A<\?xml\s+version=(?:"1\.0"|'1\.0')(?:\s+encoding=(?:"UTF-8"|'UTF-8'))?\s*\?>""",
        "", text, count=1, flags=re.IGNORECASE,
    )
    if "<?" in text:
        _invalid()
    root = ET.fromstring(text)
    count = 0
    pending = [(root, 1)]
    while pending:
        node, depth = pending.pop()
        count += 1
        if (
            count > MAX_XML_NODES or depth > MAX_XML_DEPTH
            or not ATOM.fullmatch(node.tag) or node.tag.lower() in ("x-pre-process", "include")
            or any(token in value for value in node.attrib.values() for token in DYNAMIC)
            or any(token in (node.text or "") for token in DYNAMIC)
            or any(token in (node.tail or "") for token in DYNAMIC)
        ):
            _invalid()
        pending.extend((child, depth + 1) for child in node)
    if root.tag != "document" or root.get("type") != "freeswitch/xml":
        _invalid()
    return root


def _one(nodes, *, required=True):
    if len(nodes) > 1 or (required and not nodes):
        _invalid()
    return nodes[0] if nodes else None


def _named(parent, tag, name, *, required=True):
    node = _one(
        [node for node in parent.iter(tag) if node.get("name", "").lower() == name],
        required=required,
    )
    if node is not None and (node not in parent or node.get("name") != name):
        _invalid()
    return node


def _setting(config, name):
    settings = _one(config.findall("settings"))
    matches = [node for node in config.iter("param") if node.get("name", "").lower() == name]
    if not matches:
        return None
    param = _one(matches)
    if param not in settings or param.get("name") != name or param.get("value") is None or len(param):
        _invalid()
    return param.get("value")


def _fs_selections(raw, target):
    root = _document(raw)
    section = _named(root, "section", "configuration")
    switch = _named(section, "configuration", "switch.conf")
    post_load = _named(section, "configuration", "post_load_switch.conf", required=False)
    core = _setting(switch, "core-db-dsn")
    if post_load is not None:
        post_dsn = _setting(post_load, "core-db-dsn")
        if core is not None and post_dsn is not None and core != post_dsn:
            _invalid()
        core = post_dsn if post_dsn is not None else core

    sofia = _named(section, "configuration", "sofia.conf", required=False)
    selections = []
    if sofia is not None:
        profiles = _one(sofia.findall("profiles"))
        seen = set()
        if len(profiles) > MAX_PROFILES:
            _invalid()
        for profile in profiles:
            name = _atom(profile.get("name"))
            if profile.tag != "profile" or name in seen:
                _invalid()
            seen.add(name)
            selections.append(_selection(_setting(profile, "odbc-dsn"), target, freeswitch=True))
    return _selection(core, target, freeswitch=True), selections


def classify_freeswitch(before, after, target):
    """Classify literal core and Sofia selections in a stable expanded document."""
    if (
        type(before) is not FsSample or type(after) is not FsSample
        or not same_held(before.held, after.held)
        or type(before.expanded_xml) is not bytes or type(after.expanded_xml) is not bytes
        or len(before.expanded_xml) > MAX_XML or len(after.expanded_xml) > MAX_XML
        or before.expanded_xml != after.expanded_xml
    ):
        return FsConfiguration()
    try:
        core, profiles = _fs_selections(before.expanded_xml, _target(target))
    except (ValueError, ET.ParseError):
        return FsConfiguration()
    return FsConfiguration(
        core, len(profiles), profiles.count(Selection.LEGACY), profiles.count(Selection.RESTRICTED),
        profiles.count(Selection.OTHER), profiles.count(Selection.UNKNOWN),
    )
