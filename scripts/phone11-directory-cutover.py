#!/usr/bin/env python3
"""Narrow XML-curl directory cutover; never enable dialplan or voicemail.

Run only after the same-image Basic authentication/module-reload clone passes.
The prepared input directory contains private credentials; no XML is printed.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import stat
import subprocess
import tempfile
import xml.etree.ElementTree as ET

STATE = Path('/var/lib/phone11-directory-candidate-20260927')
TARGET = Path('/opt/phone11ai/cloudphone11/infra/configs/freeswitch/autoload_configs/xml_curl.conf.xml')
ESL_CONFIG = TARGET.with_name('event_socket.conf.xml')
FS_ID = '1a575aa273fa62e3184e1a2c650322dcdec776dc8ac8707c10be95450143014b'
FS_IMAGE = 'sha256:b31c743f4c911a19687c61e3214968f2a24f93f9d3d667cc26284192e158ffc6'
API_ID = '57ff451131c00a5db21c87292ff49acd47f6c6887c162c77fb390d6e1472e74b'
API_IMAGE = 'sha256:0b1d80755c400eb59fa7fd75493b3a78cf4b39ea2cc65732aaf17231ca93ca75'
OLD_HASH = '6de7e691e237bb9bc9d29c3c1f539c6f593fffee56df4a3cd79f2e9cf729473b'
NEW_HASH = '404d486fc46aa44d100d43a4c30507b8231d6ae2d45540cc3225b224043599ce'
# 1.10.12 destroys XML-curl parameter maps before unbinding the lookup callback.
# A safe replacement lifecycle must be implemented and reviewed before mutation.
MUTATION_READY = False


class Refused(Exception):
    pass


def need(condition, reason):
    if not condition:
        raise Refused(reason)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_file(path, private=False):
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode), 'file_type')
    if private:
        parent = path.parent
        while True:
            info = parent.lstat()
            need(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and
                 stat.S_IMODE(info.st_mode) & 0o022 == 0, 'private_parent')
            if parent == parent.parent:
                break
            parent = parent.parent
        need(before.st_uid == 0 and stat.S_IMODE(before.st_mode) == 0o600, 'private_file')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        need((info.st_ino, info.st_dev) == (before.st_ino, before.st_dev) and
             0 < info.st_size < 1024 * 1024, 'file_identity')
        data = os.read(fd, 1024 * 1024)
        need(len(data) == info.st_size, 'file_size')
        return data
    finally:
        os.close(fd)


def inspect(identity, image, healthy=False):
    result = subprocess.run(['docker', 'inspect', identity], capture_output=True, timeout=10)
    need(result.returncode == 0, 'container_unavailable')
    items = json.loads(result.stdout)
    need(len(items) == 1, 'container_shape')
    item = items[0]
    need(item['Id'] == identity and item['Image'] == image and item['State']['Running'], 'container_identity')
    if healthy:
        need(item['State'].get('Health', {}).get('Status') == 'healthy', 'api_health')
    return item


class Esl:
    def __init__(self):
        values = {p.get('name'): p.get('value') for p in ET.fromstring(read_file(ESL_CONFIG)).findall('.//param')}
        password = values.get('password', '')
        need(password and not any(c in password for c in '\r\n\0'), 'esl_config')
        self.connection = socket.create_connection(('127.0.0.1', 8021), timeout=10)
        self.file = self.connection.makefile('rb')
        headers, _ = self.frame()
        need(headers.get('content-type') == 'auth/request', 'esl_challenge')
        self.connection.sendall(('auth ' + password + '\n\n').encode())
        headers, _ = self.frame()
        need(headers.get('reply-text', '').startswith('+OK'), 'esl_auth')

    def frame(self):
        headers = {}
        for _ in range(100):
            line = self.file.readline(8193)
            need(0 < len(line) <= 8192, 'esl_header')
            if line in (b'\n', b'\r\n'):
                break
            key, value = line.decode().strip().split(':', 1)
            headers[key.lower()] = value.strip()
        else:
            raise Refused('esl_header_count')
        length = int(headers.get('content-length', '0'))
        need(0 <= length <= 1024 * 1024, 'esl_body_size')
        body = self.file.read(length)
        need(len(body) == length, 'esl_body')
        return headers, body.decode()

    def api(self, command):
        self.connection.sendall(('api ' + command + '\n\n').encode())
        headers, body = self.frame()
        need(headers.get('content-type') == 'api/response', 'esl_response')
        return body.strip()

    def close(self):
        self.file.close()
        self.connection.close()


def replace(data, expected_hash):
    need(digest(read_file(TARGET)) == expected_hash, 'active_config_changed')
    fd, name = tempfile.mkstemp(prefix='.phone11-directory-', dir=TARGET.parent)
    try:
        with os.fdopen(fd, 'wb') as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        # Check again after preparing the replacement; never overwrite drift.
        need(digest(read_file(TARGET)) == expected_hash, 'active_config_changed')
        os.replace(name, TARGET)
        directory = os.open(TARGET.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def reload_directory(esl):
    need('+OK' in esl.api('reloadxml'), 'reload_xml')
    result = esl.api('reload mod_xml_curl')
    need('-ERR' not in result and '+OK' in result, 'reload_module')
    need(esl.api('module_exists mod_xml_curl') == 'true', 'module_missing')


def run(action):
    need(action == 'verify' or MUTATION_READY, 'directory_reload_uncommissioned')
    previous = read_file(STATE / 'previous.xml', private=True)
    candidate = read_file(STATE / 'candidate.xml', private=True)
    need(digest(previous) == OLD_HASH and digest(candidate) == NEW_HASH, 'prepared_bytes')
    fs = inspect(FS_ID, FS_IMAGE)
    if action != 'rollback':
        inspect(API_ID, API_IMAGE, healthy=True)
    initial = digest(read_file(TARGET))
    need(initial in {OLD_HASH, NEW_HASH}, 'active_config_changed')
    esl = Esl()
    changed = False
    try:
        count = esl.api('show channels count')
        need(re.fullmatch(r'0 total\.', count) is not None, 'active_calls')
        need(esl.api('module_exists mod_xml_curl') == 'true', 'module_missing')
        if action == 'verify':
            return {'state': 'ready' if initial == OLD_HASH else 'installed', 'active_sha256': initial}
        target, expected = (candidate, OLD_HASH) if action == 'apply' else (previous, NEW_HASH)
        wanted = digest(target)
        if initial != wanted:
            need(initial == expected, 'active_config_changed')
            # rename may succeed even when the following fsync raises.
            changed = True
            replace(target, expected)
        reload_directory(esl)
        if action == 'apply':
            for user in ('3001', '1020'):
                need(re.fullmatch(r'[a-fA-F0-9]{32}', esl.api(f'user_data {user}@sip.phone11.ai param a1-hash')) is not None,
                     'directory_lookup')
        after = inspect(FS_ID, FS_IMAGE)
        need(after['State']['Pid'] == fs['State']['Pid'], 'fs_process_changed')
        need(digest(read_file(TARGET)) == wanted, 'installed_bytes')
        return {'state': 'applied' if action == 'apply' else 'rolled_back', 'active_sha256': wanted,
                'fs_process_preserved': True, 'dialplan_changed': False}
    except Exception:
        if action == 'apply' and changed:
            # Do not overwrite an unrelated operator's intervening config.
            current = digest(read_file(TARGET))
            if current == NEW_HASH:
                replace(previous, NEW_HASH)
                reload_directory(esl)
            else:
                need(current == OLD_HASH, 'rollback_config_changed')
        raise
    finally:
        esl.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('verify', 'apply', 'rollback'))
    args = parser.parse_args()
    try:
        need(os.geteuid() == 0, 'root_required')
        fd = os.open('/run/phone11-directory-cutover.lock', os.O_CREAT | os.O_NOFOLLOW | os.O_RDWR, 0o600)
        with os.fdopen(fd, 'w'):
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            print(json.dumps(run(args.action)))
    except Exception as error:
        print(json.dumps({'state': 'refused', 'stage': str(error) if isinstance(error, Refused) else type(error).__name__}))
        raise SystemExit(1)
