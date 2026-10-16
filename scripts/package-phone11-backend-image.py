#!/usr/bin/env python3
"""Optional Docker-save package of the exact successfully smoked public CI image.

No build, container commit, credentials, upload, image removal or retry. A failed
new output is retained, never resumed; only exit0 plus its manifest is usable.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time

MAX_BYTES = 4 * 1024**3
DISK_RESERVE = 1024**3
SECONDS = 300
FIELDS = ('st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_mode', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
IMAGE_FORMAT = '{"imageId":"{{.Id}}","os":"{{.Os}}","architecture":"{{.Architecture}}","revision":"{{index .Config.Labels "org.opencontainers.image.revision"}}","size":{{.Size}}}'


class Refused(Exception):
    pass


def need(value, reason):
    if not value:
        raise Refused(reason)


def parents(path):
    for parent in path.parents:
        need(stat.S_ISDIR(parent.lstat().st_mode), 'UNSAFE_PARENT')


def same(left, right, fields=FIELDS):
    return all(getattr(left, key) == getattr(right, key) for key in fields)


def parse(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            need(key not in result, 'INVALID_JSON')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: need(False, 'INVALID_JSON'))


def close_all(items):
    failed = False
    for item in items:
        try:
            item.close()
        except OSError:
            failed = True
    need(not failed, 'CLOSE_FAILED')


class Receipt:
    def __init__(self, path):
        self.path, self.fd = Path(path), None
        parents(self.path)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
        try:
            self.before = os.fstat(fd)
            need(stat.S_ISREG(self.before.st_mode) and self.before.st_uid == os.getuid()
                 and self.before.st_nlink == 1 and stat.S_IMODE(self.before.st_mode) == 0o600
                 and 0 < self.before.st_size <= 8192, 'INVALID_RECEIPT')
            raw = b''
            while len(raw) <= self.before.st_size:
                part = os.read(fd, min(8192, self.before.st_size + 1 - len(raw)))
                if not part:
                    break
                raw += part
            need(len(raw) == self.before.st_size, 'INVALID_RECEIPT')
            self.value = parse(raw)
            self.sha256 = hashlib.sha256(raw).hexdigest()
            self.fd, fd = fd, None
            self.stable()
        finally:
            if fd is not None:
                os.close(fd)
            # stable() can fail after the descriptor has been assigned.
            if sys.exc_info()[0] is not None:
                self.close()

    def stable(self):
        parents(self.path)
        need(same(self.before, self.path.lstat())
             and (self.fd is None or same(self.before, os.fstat(self.fd))), 'RECEIPT_CHANGED')

    def close(self):
        if self.fd is not None:
            fd, self.fd = self.fd, None
            os.close(fd)


def validate(commit, metadata, smoke):
    need(type(commit) is str and re.fullmatch('[a-f0-9]{40}', commit), 'INVALID_COMMIT')
    need(type(metadata) is dict and set(metadata) == {'sourceCommit', 'platform', 'imageId', 'localTag', 'published', 'applicationStarted'}, 'INVALID_METADATA')
    need(metadata['sourceCommit'] == commit and metadata['platform'] == 'linux/amd64'
         and metadata['localTag'] == 'phone11-backend-check:' + commit
         and metadata['published'] is False and metadata['applicationStarted'] is False
         and type(metadata['imageId']) is str
         and re.fullmatch('sha256:[a-f0-9]{64}', metadata['imageId']), 'INVALID_METADATA')
    expected = {'sourceCommit': commit, 'platform': 'linux/amd64', 'imageId': metadata['imageId'],
                'status': 'PROCESS_SMOKE_PASSED', 'phase': 'complete', 'startDispatched': True,
                'healthAccepted': True, 'gracefulShutdownAccepted': True,
                'cleanup': 'OWNED_CONTAINER_REMOVED', 'observedRunning': False,
                'observedExitCode': 0, 'observedOOM': False, 'runtimeAcceptance': False,
                'failureLogClass': 'NOT_COLLECTED', 'privateDiagnosticCaptured': False}
    need(type(smoke) is dict and set(smoke) == set(expected) | {'nonce', 'containerId'}, 'INVALID_SMOKE')
    need(all(type(smoke[key]) is type(value) and smoke[key] == value for key, value in expected.items())
         and type(smoke['nonce']) is str and re.fullmatch('[a-f0-9]{32}', smoke['nonce'])
         and type(smoke['containerId']) is str and re.fullmatch('[a-f0-9]{64}', smoke['containerId']), 'INVALID_SMOKE')
    return metadata['imageId']


class Archive:
    def __init__(self, path, deadline, guard):
        self.path, self.deadline, self.guard = Path(path), deadline, guard
        self.fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        try:
            self.snapshot = os.fstat(self.fd)
            need(self.snapshot.st_size == 0, 'ARCHIVE_CHANGED')
            self.total = 0
            self.hasher = hashlib.sha256()
            self.stable()
        except BaseException:
            self.close()
            raise

    def stable(self):
        parents(self.path)
        current = os.fstat(self.fd) if self.fd is not None else self.path.lstat()
        need(stat.S_ISREG(current.st_mode) and current.st_uid == os.getuid()
             and current.st_nlink == 1 and stat.S_IMODE(current.st_mode) == 0o600
             and same(self.snapshot, current) and same(current, self.path.lstat()), 'ARCHIVE_CHANGED')

    def write(self, raw):
        self.guard()
        self.stable()
        need(time.monotonic() < self.deadline, 'PACKAGE_TIMEOUT')
        need(self.total + len(raw) <= MAX_BYTES, 'ARCHIVE_SIZE_CAP')
        need(shutil.disk_usage(self.path.parent).free >= DISK_RESERVE + len(raw), 'DISK_RESERVE')
        view = memoryview(raw)
        while view:
            size = os.write(self.fd, view)
            need(size > 0, 'ARCHIVE_WRITE_FAILED')
            view = view[size:]
        self.total += len(raw)
        self.hasher.update(raw)
        current = os.fstat(self.fd)
        need(same(current, self.path.lstat()) and current.st_size == self.total
             and same(current, self.snapshot, FIELDS[:6]), 'ARCHIVE_CHANGED')
        self.snapshot = current  # Only our exact-size append may change size/times.

    def finish(self):
        self.guard()
        self.stable()
        need(self.total > 0, 'EMPTY_ARCHIVE')
        os.fsync(self.fd)
        measured = hashlib.sha256()
        offset = 0
        while offset < self.total:
            need(time.monotonic() < self.deadline, 'PACKAGE_TIMEOUT')
            raw = os.pread(self.fd, min(1024**2, self.total - offset), offset)
            need(raw, 'ARCHIVE_READBACK_FAILED')
            measured.update(raw)
            offset += len(raw)
        self.guard()
        self.stable()
        need(measured.digest() == self.hasher.digest(), 'ARCHIVE_HASH_MISMATCH')
        return measured.hexdigest()

    def close(self):
        if self.fd is not None:
            fd, self.fd = self.fd, None
            os.close(fd)


class Docker:
    def __init__(self, directory, deadline):
        executable = shutil.which('docker')
        need(executable, 'DOCKER_UNAVAILABLE')
        self.prefix = [executable, '--host', 'unix:///var/run/docker.sock', '--config', directory]
        self.env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': directory, 'LANG': 'C'}
        self.deadline = deadline

    def stream(self, args, consume, seconds):
        end = min(self.deadline, time.monotonic() + seconds)
        need(end > time.monotonic(), 'PACKAGE_TIMEOUT')
        with subprocess.Popen(self.prefix + args, env=self.env, stdin=subprocess.DEVNULL,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE) as child:
            selector = selectors.DefaultSelector()
            try:
                selector.register(child.stdout, selectors.EVENT_READ, True)
                selector.register(child.stderr, selectors.EVENT_READ, False)
                while selector.get_map():
                    remaining = end - time.monotonic()
                    need(remaining > 0, 'PACKAGE_TIMEOUT')
                    events = selector.select(remaining)
                    need(events, 'PACKAGE_TIMEOUT')
                    for key, _ in events:
                        raw = os.read(key.fileobj.fileno(), 65536)
                        if not raw:
                            selector.unregister(key.fileobj)
                        else:
                            need(key.data, 'DOCKER_STDERR')
                            consume(raw)
                need(child.wait(timeout=max(0.001, end - time.monotonic())) == 0, 'DOCKER_EXIT')
            finally:
                selector.close()
                if child.poll() is None:
                    child.kill()
                child.wait(timeout=2)

    def inspect(self, image):
        raw = bytearray()
        def collect(part):
            need(len(raw) + len(part) <= 2048, 'IMAGE_INSPECTION_LIMIT')
            raw.extend(part)
        self.stream(['image', 'inspect', '--format', IMAGE_FORMAT, image], collect, 15)
        return parse(bytes(raw))

    def save(self, image, archive):
        self.stream(['image', 'save', image], archive.write, SECONDS)


def destination_check(destination):
    need(destination.is_absolute(), 'INVALID_DESTINATION')
    parents(destination)
    need(not os.path.lexists(destination), 'OUTPUT_COLLISION')
    need(shutil.disk_usage(destination.parent).free >= MAX_BYTES + DISK_RESERVE, 'DISK_BUDGET')


def package(commit, metadata, smoke, destination, docker, deadline):
    image = validate(commit, metadata.value, smoke.value)
    destination = Path(destination)
    destination_check(destination)
    expected = docker.inspect(image)
    need(type(expected) is dict and set(expected) == {'imageId', 'os', 'architecture', 'revision', 'size'}
         and expected['imageId'] == image and expected['os'] == 'linux'
         and expected['architecture'] == 'amd64' and expected['revision'] == commit
         and type(expected['size']) is int and 0 < expected['size'] <= MAX_BYTES, 'IMAGE_MISMATCH')
    metadata.stable()
    smoke.stable()
    destination.mkdir(mode=0o700)
    directory_fd = os.open(destination, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    directory_before = None
    archive, manifest_fd = None, None
    entries = set()
    def directory_stable(own_creation=False):
        nonlocal directory_before
        parents(destination)
        current = os.fstat(directory_fd)
        # APFS counts a newly created regular child in directory nlink; Linux
        # does not. Only this known one-file creation may account for that delta.
        if own_creation:
            unchanged = same(directory_before, current, FIELDS[:5]) and current.st_nlink in (directory_before.st_nlink, directory_before.st_nlink + 1)
        else:
            unchanged = same(directory_before, current)
        names = set()
        with os.scandir(directory_fd) as children:
            for child in children:
                need(len(names) < len(entries), 'OUTPUT_CHANGED')
                names.add(child.name)
        need(stat.S_IMODE(current.st_mode) == 0o700 and current.st_uid == os.getuid()
             and same(current, destination.lstat()) and unchanged and names == entries, 'OUTPUT_CHANGED')
        directory_before = current
    def guard():
        need(time.monotonic() < deadline, 'PACKAGE_TIMEOUT')
        directory_stable()
        metadata.stable()
        smoke.stable()
    try:
        directory_before = os.fstat(directory_fd)
        guard()
        archive = Archive(destination / 'backend-image.tar', deadline, guard)
        entries.add('backend-image.tar')
        directory_stable(own_creation=True)
        docker.save(image, archive)
        archive_sha = archive.finish()
        need(docker.inspect(image) == expected, 'IMAGE_CHANGED')
        guard()
        archive.stable()
        # Close all held inputs/archive before creating a success manifest.
        close_all([archive, metadata, smoke])
        guard()
        archive.stable()
        value = {'status': 'PUBLIC_CI_IMAGE_PACKAGED', 'sourceCommit': commit,
                 'platform': 'linux/amd64', 'imageId': image, 'archive': 'backend-image.tar',
                 'archiveFormat': 'docker-save-tar', 'archiveSha256': archive_sha,
                 'archiveBytes': archive.total, 'metadataSha256': metadata.sha256,
                 'processSmokeSha256': smoke.sha256, 'processSmokePassed': True,
                 'ownedSmokeContainerRemoved': True, 'publicCiBuildRequired': True,
                 'runtimeContainerCommitted': False, 'runtimeAcceptance': False,
                 'deploymentAuthority': False}
        raw = (json.dumps(value, sort_keys=True) + '\n').encode()
        need(len(raw) <= 2048 and time.monotonic() < deadline, 'PACKAGE_TIMEOUT_OR_MANIFEST_LIMIT')
        manifest = destination / 'manifest.json'
        manifest_fd = os.open(manifest, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        entries.add('manifest.json')
        directory_stable(own_creation=True)
        before = os.fstat(manifest_fd)
        view = memoryview(raw)
        while view:
            size = os.write(manifest_fd, view)
            need(size > 0, 'MANIFEST_WRITE_FAILED')
            view = view[size:]
        os.fsync(manifest_fd)
        after = os.fstat(manifest_fd)
        need(same(before, after, FIELDS[:6]) and same(after, manifest.lstat())
             and after.st_size == len(raw) and stat.S_IMODE(after.st_mode) == 0o600
             and os.pread(manifest_fd, len(raw) + 1, 0) == raw, 'MANIFEST_CHANGED')
        closing, manifest_fd = manifest_fd, None
        os.close(closing)
        guard()
        archive.stable()
        need(same(after, manifest.lstat()), 'MANIFEST_CHANGED')
        os.fsync(directory_fd)
        directory_stable()
        closing, directory_fd = directory_fd, None
        os.close(closing)
        need(same(directory_before, destination.lstat()) and same(after, manifest.lstat())
             and same(archive.snapshot, archive.path.lstat()) and time.monotonic() < deadline, 'FINAL_OUTPUT_CHANGED')
        return value
    finally:
        # Partial output remains private and consumed. Never retry/adopt it or
        # infer success from file presence after a late close/fsync failure.
        items = [item for item in (archive,) if item is not None]
        try:
            close_all(items)
        finally:
            failed = False
            for fd in (manifest_fd, directory_fd):
                if fd is not None:
                    try:
                        os.close(fd)
                    except OSError:
                        failed = True
            need(not failed, 'CLOSE_FAILED')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--commit', required=True)
    parser.add_argument('--metadata', required=True)
    parser.add_argument('--smoke', required=True)
    parser.add_argument('--output', required=True, help='New absolute private directory; never resume partial output')
    args = parser.parse_args()
    receipts = []
    previous_handler = None
    try:
        for path in [args.metadata, args.smoke]:
            receipts.append(Receipt(path))
        validate(args.commit, receipts[0].value, receipts[1].value)
        destination_check(Path(args.output))
        deadline = time.monotonic() + SECONDS
        def interrupted(_signal, _frame):
            raise Refused('PACKAGE_INTERRUPTED')
        previous_handler = signal.signal(signal.SIGTERM, interrupted)
        with tempfile.TemporaryDirectory(prefix='phone11-package-config-') as directory:
            os.chmod(directory, 0o700)
            Path(directory, 'config.json').write_text('{}\n')
            value = package(args.commit, *receipts, args.output, Docker(directory, deadline), deadline)
        print(json.dumps(value, sort_keys=True))
        return 0
    finally:
        try:
            close_all(receipts)
        finally:
            if previous_handler is not None:
                signal.signal(signal.SIGTERM, previous_handler)


def cli():
    try:
        return main()
    except Refused as error:
        print(json.dumps({'status': 'PACKAGE_REFUSED', 'reason': str(error)}))
        return 1
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
        print('{"status":"PACKAGE_REFUSED","reason":"PACKAGE_IO_FAILED"}')
        return 1


if __name__ == '__main__':
    raise SystemExit(cli())
