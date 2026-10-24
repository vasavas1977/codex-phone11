"""Source-only finite, non-destructive CDR replay engine. No network adapter/CLI.

Caller supplies bounded transport, current tenant/route admission and independent
producer-completion evidence. Stable reads alone are NOT completion evidence.
Only private state files change. Original spool entries are never modified.
"""
import bisect
import fcntl
import hashlib
import json
import os
import re
import stat
import time
import urllib.parse
import xml.etree.ElementTree as ET
from dataclasses import dataclass

UUID = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
NAME = re.compile(r'(?:a_)?(' + UUID + r')\.cdr\.xml\Z')
SIDECAR_SHA = '73038405a623499d8907f6c77d09939532bee74d1d9df15021c21072b99bff10'

class Refused(Exception):
    pass

def need(value, code):
    if not value:
        raise Refused(code)

def frame(s):
    return (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid,
            s.st_nlink, s.st_size, s.st_mtime_ns, s.st_ctime_ns)

def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()

@dataclass(frozen=True)
class Limits:
    entries: int = 32
    body_bytes: int = 524288
    pass_seconds: float = 30
    transport_seconds: float = 3
    settle_seconds: float = 1
    state_bytes: int = 8192
    census_entries: int = 4096
    max_attempts: int = 3
    backoff_seconds: int = 30

class Directory:
    """Held no-follow ancestors; revalidate pathname custody before every action."""
    def __init__(self, path, uid):
        need(os.path.isabs(path) and os.path.normpath(path) == path, 'PATH')
        self.fds = []
        self.records = []
        try:
            fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
            self.fds.append(fd)
            for part in path.split('/')[1:]:
                need(part not in ('', '.', '..'), 'PATH_COMPONENT')
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                self.fds.append(child)
                s = os.fstat(child)
                # Root-owned sticky ancestors (e.g. /tmp) may hold our private dir.
                sticky = s.st_uid == 0 and bool(s.st_mode & stat.S_ISVTX)
                need(s.st_uid in (0, uid) and (not s.st_mode & 0o022 or sticky), 'ANCESTOR')
                self.records.append((fd, part, child, frame(s)[:5]))
                fd = child
            self.fd = fd
            s = os.fstat(fd)
            need(s.st_uid == uid and stat.S_IMODE(s.st_mode) == 0o700, 'PRIVATE_DIRECTORY')
            self.identity = (s.st_dev, s.st_ino)
            self.check()
        except BaseException:
            self.close()
            raise

    def check(self):
        for parent, name, fd, expected in self.records:
            a = os.stat(name, dir_fd=parent, follow_symlinks=False)
            need(frame(a)[:5] == expected == frame(os.fstat(fd))[:5], 'DIRECTORY_CHANGED')

    def close(self):
        for fd in reversed(self.fds):
            os.close(fd)
        self.fds = []


def parse_payload(raw, name, limit):
    match = NAME.fullmatch(name)
    need(match is not None and 0 < len(raw) <= limit, 'NAME_OR_SIZE')
    # Producer's curl escaping uses percent escapes, never literal form delimiters.
    need(re.fullmatch(rb'(?:[A-Za-z0-9_.~-]|%[0-9A-Fa-f]{2})+', raw) is not None, 'ENCODING')
    decoded = urllib.parse.unquote_to_bytes(raw)
    need(len(decoded) <= limit and b'\x00' not in decoded, 'XML_SIZE')
    text = decoded.decode('utf-8', errors='strict')
    need('<!DOCTYPE' not in text.upper() and '<!ENTITY' not in text.upper(), 'XML_DECLARATION')
    root = ET.fromstring(text)
    need(root.tag == 'cdr' and len(root.findall('variables')) == 1 , 'XML_ROOT')
    todo = [(root, 1)]; nodes = 0
    while todo:
        node, depth = todo.pop(); nodes += 1
        need(depth <= 32 and nodes <= 8192, 'XML_NODES_OR_DEPTH')
        todo.extend((child, depth + 1) for child in node)
    need(not root.find('variables').attrib, 'VARIABLE_SHAPE')
    values = {}
    for node in root.find('variables'):
        need(node.tag not in values and not node.attrib and not list(node), 'VARIABLE_SHAPE')
        need(len(node.text or '') <= 65536 and re.search(r'%(?![0-9A-Fa-f]{2})', node.text or '') is None, 'VARIABLE_ENCODING')
        # Native XML channel variable text is itself URL-escaped (same as sink parser).
        values[node.tag] = urllib.parse.unquote(node.text or '', errors='strict')
    need(len(values) <= 2048, 'VARIABLE_COUNT')
    uuid = values.get('uuid', '')
    need(uuid == match[1] and re.fullmatch(UUID, uuid) is not None, 'UUID')
    tenant = values.get('tenant_id', '')
    need(re.fullmatch(r'[1-9][0-9]{0,9}', tenant) is not None and int(tenant) <= 2147483647, 'TENANT')
    # A replay entry must describe a completed call, not a prefix/in-progress CDR.
    def epoch(k):
        value = values.get(k, '0')
        need(re.fullmatch(r'[0-9]{1,12}', value) is not None, 'EPOCH')
        return int(value)
    start, answer, end = (epoch(k) for k in ('start_epoch', 'answer_epoch', 'end_epoch'))
    need(0 < start <= end <= time.time() + 2 and (answer == 0 or start <= answer <= end), 'TERMINAL_EPOCHS')
    # No parent/callflow fallback ownership; no body mutation or caller-profile assertion.
    return {'uuid': uuid, 'tenantId': int(tenant), 'sha256': hashlib.sha256(raw).hexdigest()}

class Worker:
    def __init__(self, spool, state, transport, admit, completion_proof, *,
                 limits=Limits(), uid=0, clock=time.monotonic, pause=time.sleep, wallclock=time.time):
        need(1 <= limits.entries <= 128 and 0 < limits.body_bytes <= 524288
             and 0 < limits.pass_seconds <= 60 and 0 < limits.transport_seconds <= 5
             and 0 <= limits.settle_seconds <= 5 and 1024 <= limits.state_bytes <= 8192
             and limits.entries <= limits.census_entries <= 4096 and 1 <= limits.max_attempts <= 5
             and 1 <= limits.backoff_seconds <= 3600, 'LIMITS')
        need(os.path.commonpath((spool, state)) not in (spool, state), 'OVERLAPPING_DIRECTORIES')
        need(callable(transport) and callable(admit) and callable(completion_proof), 'EXPLICIT_ADAPTERS')
        self.paths = spool, state
        self.transport, self.admit, self.completion = transport, admit, completion_proof
        self.limits, self.uid, self.clock, self.pause = limits, uid, clock, pause
        self.wallclock = wallclock

    def read_entry(self, directory, name):
        directory.check()
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory.fd)
        try:
            s = os.fstat(fd)
            need(stat.S_ISREG(s.st_mode) and s.st_uid == self.uid and s.st_nlink == 1
                 and not s.st_mode & 0o022 and 0 < s.st_size <= self.limits.body_bytes, 'ENTRY_CUSTODY')
            expected = frame(s)
            need(time.time_ns() - s.st_mtime_ns >= int(self.limits.settle_seconds * 1e9), 'ENTRY_YOUNG')
            raw = os.read(fd, self.limits.body_bytes + 1)
            need(len(raw) == s.st_size and os.read(fd, 1) == b'', 'ENTRY_READ')
            self.pause(self.limits.settle_seconds)
            os.lseek(fd, 0, os.SEEK_SET)
            need(os.read(fd, self.limits.body_bytes + 1) == raw, 'ENTRY_CHANGED')
            self.same_entry(directory, name, expected, fd)
            identity = parse_payload(raw, name, self.limits.body_bytes)
            need(self.admit(dict(identity)) is True, 'ADMISSION')
            need(self.completion(dict(identity), expected) is True, 'COMPLETION_UNPROVED')
            self.same_entry(directory, name, expected, fd)
            return fd, expected, raw, identity
        except BaseException:
            os.close(fd)
            raise

    def same_entry(self, directory, name, expected, fd):
        directory.check()
        need(frame(os.fstat(fd)) == expected
             and frame(os.stat(name, dir_fd=directory.fd, follow_symlinks=False)) == expected, 'ENTRY_CHANGED')

    def read_state(self, directory, name):
        directory.check()
        try:
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory.fd)
        except FileNotFoundError:
            return None
        try:
            s = os.fstat(fd)
            need(stat.S_ISREG(s.st_mode) and s.st_uid == self.uid and s.st_nlink == 1
                 and stat.S_IMODE(s.st_mode) == 0o600 and s.st_size <= self.limits.state_bytes, 'JOURNAL_CUSTODY')
            raw = os.read(fd, self.limits.state_bytes + 1)
            need(len(raw) == s.st_size and frame(os.fstat(fd)) == frame(s)
                 and frame(os.stat(name, dir_fd=directory.fd, follow_symlinks=False)) == frame(s), 'JOURNAL_CHANGED')
            os.fsync(fd)
            os.fsync(directory.fd)
            return json.loads(raw)
        finally:
            os.close(fd)

    def load(self, directory, name):
        value = self.read_state(directory, name)
        if value is None:
            return None
        need(type(value) is dict and set(value) == {'schema','identity','status','receiverSource','ack','attempts','nextAttemptAt'}, 'JOURNAL_SHAPE')
        need(value['schema'] == 2 and value['receiverSource'] == SIDECAR_SHA
             and value['status'] in ('INTENT','ACK','HTTP_FAILURE','UNKNOWN','RETRY')
             and type(value['attempts']) is int and 1 <= value['attempts'] <= self.limits.max_attempts
             and type(value['nextAttemptAt']) is int and value['nextAttemptAt'] >= 0, 'JOURNAL_SHAPE')
        return value

    def page(self, spool, state):
        cursor = self.read_state(state, 'scan-cursor.json')
        if cursor is not None:
            need(type(cursor) is dict and set(cursor) == {'schema','after'} and cursor['schema'] == 1
                 and type(cursor['after']) is str and 0 < len(cursor['after']) <= 255
                 and '/' not in cursor['after'] and cursor['after'] not in ('.','..'), 'CURSOR')
        names = []
        with os.scandir(spool.fd) as entries:
            for entry in entries:
                need(len(names) < self.limits.census_entries, 'CENSUS_BOUND')
                names.append(entry.name)
        names.sort()
        after = bisect.bisect_right(names, cursor['after']) if cursor else 0
        return names[after:] + names[:after]

    def snapshot(self, directory, name, raw, create):
        directory.check()
        try:
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory.fd)
        except FileNotFoundError:
            need(create, 'SNAPSHOT_MISSING')
            fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o600, dir_fd=directory.fd)
            try:
                os.fchmod(fd, 0o600)
                with os.fdopen(fd, 'wb', closefd=False) as stream:
                    stream.write(raw); stream.flush(); os.fsync(fd)
                directory.check()
                os.fsync(directory.fd)
            finally:
                os.close(fd)
            # Verify the durable snapshot before recording intent or calling HTTP.
            return self.snapshot(directory, name, raw, False)
        try:
            s = os.fstat(fd)
            need(stat.S_ISREG(s.st_mode) and s.st_uid == self.uid and s.st_nlink == 1
                 and stat.S_IMODE(s.st_mode) == 0o600 and s.st_size == len(raw), 'SNAPSHOT_CUSTODY')
            need(os.read(fd, self.limits.body_bytes + 1) == raw
                 and frame(os.fstat(fd)) == frame(s)
                 and frame(os.stat(name, dir_fd=directory.fd, follow_symlinks=False)) == frame(s), 'SNAPSHOT_CHANGED')
            os.fsync(fd)
            os.fsync(directory.fd)
            directory.check()
        finally:
            os.close(fd)

    def save(self, directory, name, record):
        directory.check()
        raw = canonical(record)
        need(len(raw) <= self.limits.state_bytes, 'JOURNAL_BOUND')
        temp = name + '.new'
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory.fd)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, 'wb', closefd=False) as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(fd)
            directory.check()
            os.replace(temp, name, src_dir_fd=directory.fd, dst_dir_fd=directory.fd)
            os.fsync(directory.fd)
        finally:
            os.close(fd)
        # On uncertain write failure retain .new; never guess or delete it.

    def run(self):
        spool = Directory(self.paths[0], self.uid)
        state = None
        lock = None
        summary = {'acknowledged':0, 'skippedAcknowledged':0, 'retained':0,
                   'blockedJournal':0, 'scanLimitReached':False, 'spoolModified':False}
        deadline = self.clock() + self.limits.pass_seconds
        try:
            state = Directory(self.paths[1], self.uid)
            need(state.identity != spool.identity, 'STATE_IS_SPOOL')
            lock = os.open('worker.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK,
                           0o600, dir_fd=state.fd)
            s = os.fstat(lock)
            need(stat.S_ISREG(s.st_mode) and s.st_uid == self.uid and s.st_nlink == 1
                 and stat.S_IMODE(s.st_mode) == 0o600, 'LOCK_CUSTODY')
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            os.fsync(lock)
            os.fsync(state.fd)
            for index, name in enumerate(self.page(spool, state)):
                if index >= self.limits.entries or self.clock() >= deadline:
                    summary['scanLimitReached'] = True
                    break
                self.save(state, 'scan-cursor.json', {'schema':1, 'after':name})
                fd = None
                try:
                    fd, expected, raw, identity = self.read_entry(spool, name)
                    need(self.clock() < deadline, 'DEADLINE')
                    key = hashlib.sha256(canonical(identity)).hexdigest() + '.json'
                    prior = self.load(state, key)
                    self.snapshot(state, key + '.body', raw, prior is None)
                    if prior is not None:
                        need(prior['identity'] == identity, 'JOURNAL_IDENTITY')
                        if prior['status'] == 'ACK':
                            need(valid_ack(prior['ack']), 'JOURNAL_ACK')
                            summary['skippedAcknowledged'] += 1
                            continue
                        if prior['status'] != 'RETRY' or prior['nextAttemptAt'] > self.wallclock():
                            summary['blockedJournal'] += 1
                            continue
                    record = {'schema':2, 'identity':identity, 'status':'INTENT',
                              'receiverSource':SIDECAR_SHA, 'ack':None,
                              'attempts':prior['attempts']+1 if prior else 1, 'nextAttemptAt':0}
                    self.save(state, key, record) # crash now blocks redispatch
                    self.same_entry(spool, name, expected, fd)
                    need(self.clock() < deadline, 'DEADLINE')
                    try:
                        # Adapter MUST enforce this timeout, bound response bytes,
                        # pin3030/source/auth privately, and never retry internally.
                        status, body = self.transport(b'cdr=' + raw,
                            min(self.limits.transport_seconds, deadline-self.clock()))
                    except Exception:
                        record['status'] = 'UNKNOWN'
                        self.save(state, key, record)
                        summary['retained'] += 1
                        continue
                    self.same_entry(spool, name, expected, fd)
                    need(self.clock() < deadline, 'DEADLINE')
                    self.snapshot(state, key + '.body', raw, False)
                    ack = decode_ack(status, body)
                    retry = type(status) is int and status in (500,503) and record['attempts'] < self.limits.max_attempts
                    record['status'] = 'ACK' if ack else 'RETRY' if retry else 'HTTP_FAILURE'
                    if retry:
                        record['nextAttemptAt'] = int(self.wallclock()) + min(3600, self.limits.backoff_seconds * 2**(record['attempts']-1))
                    record['ack'] = ack
                    self.save(state, key, record)
                    summary['acknowledged' if ack else 'retained'] += 1
                except (Refused, OSError, ValueError, ET.ParseError, UnicodeError):
                    summary['retained'] += 1
                finally:
                    if fd is not None:
                        os.close(fd)
            spool.check()
            state.check()
            return summary
        finally:
            if lock is not None:
                os.close(lock)
            if state is not None:
                state.close()
            spool.close()


def valid_ack(value):
    return (type(value) is dict and set(value) == {'ok','callRecordId','callLegId'}
            and value['ok'] is True and all(type(value[k]) is int and value[k] > 0
                                          for k in ('callRecordId','callLegId')))

def decode_ack(status, body):
    if type(status) is not int or status != 200 or type(body) is not bytes or len(body) > 1024:
        return None
    try:
        def unique(pairs):
            out = {}
            for k, v in pairs:
                need(k not in out, 'ACK_DUPLICATE')
                out[k] = v
            return out
        value = json.loads(body, object_pairs_hook=unique)
        return value if valid_ack(value) else None
    except (ValueError, Refused):
        return None
