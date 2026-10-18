"""Owned public bytes/fake CLI only: no Docker, build, image or upload."""
import copy
from contextlib import contextmanager, redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).absolute().parent.parent

def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

m = load(ROOT / 'scripts/package-phone11-backend-image.py', 'owned_package')
f = load(ROOT / 'tests/phone11-backend-smoke.test.py', 'owned_smoke_fixture')
PUBLIC = b'OWNED_PUBLIC_EXPORT_BYTES\n' * 3  # Not a genuine Docker TAR.

class PassedDiagnostic(f.FakeDocker):
    diagnose_start = True
    def synthetic_values(self, _values):
        pass

class FakeDocker:
    def __init__(self, mode='pass'):
        self.mode, self.calls = mode, []
        self.expected = {'imageId': f.IMAGE, 'os': 'linux', 'architecture': 'amd64', 'revision': f.COMMIT, 'size': 1}
    def inspect(self, image):
        self.calls.append(('inspect', image))
        value = copy.deepcopy(self.expected)
        if self.mode == 'identity' or self.mode == 'changed' and len(self.calls) > 1:
            value['imageId'] = 'sha256:' + 'd' * 64
        return value
    def save(self, image, archive):
        self.calls.append(('save', image))
        if self.mode == 'empty':
            return
        archive.write(PUBLIC[:13])
        if self.mode == 'exit':
            raise m.Refused('DOCKER_EXIT')
        archive.write(PUBLIC[13:])

@contextmanager
def fixture(diagnostic=False):
    with tempfile.TemporaryDirectory(prefix='.package-fixture-', dir=ROOT / 'tests') as td:
        root = Path(td)
        metadata, smoke = root / 'metadata.json', root / 'smoke.json'
        value = f.smoke.smoke(f.COMMIT, f.META, PassedDiagnostic() if diagnostic else f.FakeDocker())
        for path, body in ((metadata, f.META), (smoke, value)):
            path.write_text(json.dumps(body) + '\n')
            path.chmod(0o600)
        receipts = [m.Receipt(metadata), m.Receipt(smoke)]
        with patch.object(m.shutil, 'disk_usage', return_value=types.SimpleNamespace(free=m.MAX_BYTES + 2 * m.DISK_RESERVE)):
            try:
                yield root, receipts
            finally:
                m.close_all(receipts)

class PackageTests(unittest.TestCase):
    def package(self, root, receipts, docker=None, deadline=None):
        return m.package(f.COMMIT, *receipts, root / 'output', docker or FakeDocker(), deadline or time.monotonic() + 10)

    def test_actual_normal_and_diagnostic_success_shapes_package_only_same_image(self):
        for diagnostic in (False, True):
            with self.subTest(diagnostic=diagnostic), fixture(diagnostic) as (root, receipts):
                self.assertEqual(len(receipts[1].value), 17)
                docker = FakeDocker()
                value = self.package(root, receipts, docker)
                self.assertEqual(docker.calls, [('inspect', f.IMAGE), ('save', f.IMAGE), ('inspect', f.IMAGE)])
                self.assertEqual(value, json.loads((root / 'output/manifest.json').read_text()))
                self.assertEqual(value['archiveSha256'], hashlib.sha256(PUBLIC).hexdigest())
                self.assertEqual(value['archiveBytes'], len(PUBLIC))
                self.assertEqual((root / 'output/backend-image.tar').read_bytes(), PUBLIC)
                self.assertFalse(value['runtimeAcceptance'])
                self.assertFalse(value['deploymentAuthority'])
                self.assertFalse(value['runtimeContainerCommitted'])
                self.assertTrue(all(r.fd is None for r in receipts))
                self.assertEqual(set(p.name for p in (root / 'output').iterdir()), {'manifest.json', 'backend-image.tar'})
                self.assertEqual(stat.S_IMODE((root / 'output').stat().st_mode), 0o700)
                for path in (root / 'output').iterdir():
                    self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_failed_unbound_diagnostic_or_extra_receipt_fields_refuse_before_docker(self):
        changes = [lambda v: v.update(status='REFUSED'), lambda v: v.update(cleanup='UNKNOWN'),
                   lambda v: v.update(observedExitCode=False), lambda v: v.update(startDiagnostics={}),
                   lambda v: v.update(healthAccepted=False), lambda v: v.update(sourceCommit='d' * 40),
                   lambda v: v.update(imageId='sha256:' + 'd' * 64)]
        for change in changes:
            with fixture() as (root, receipts):
                change(receipts[1].value)
                docker = FakeDocker()
                with self.assertRaises(m.Refused):
                    self.package(root, receipts, docker)
                self.assertEqual(docker.calls, [])
                self.assertFalse((root / 'output').exists())

    def test_collision_regular_directory_and_dangling_link_never_adopt(self):
        for kind in ('file', 'dir', 'link'):
            with fixture() as (root, receipts):
                output = root / 'output'
                if kind == 'file': output.write_text('CONSUMED')
                elif kind == 'dir': output.mkdir()
                else: output.symlink_to('ABSENT')
                docker = FakeDocker()
                with self.assertRaises(m.Refused): self.package(root, receipts, docker)
                self.assertEqual(docker.calls, [])

    def test_identity_empty_exit_and_post_save_change_leave_no_success_manifest(self):
        for mode in ('identity', 'empty', 'exit', 'changed'):
            with fixture() as (root, receipts):
                with self.assertRaises(m.Refused): self.package(root, receipts, FakeDocker(mode))
                self.assertFalse((root / 'output/manifest.json').exists())

    def test_archive_cap_disk_reserve_and_expired_deadline_refuse(self):
        for mode in ('size', 'disk', 'deadline'):
            with fixture() as (root, receipts):
                docker = FakeDocker()
                if mode == 'size':
                    with patch.object(m, 'MAX_BYTES', 20):
                        with self.assertRaises(m.Refused): self.package(root, receipts, docker)
                elif mode == 'disk':
                    original = docker.save
                    def save(image, archive):
                        with patch.object(m.shutil, 'disk_usage', return_value=types.SimpleNamespace(free=0)):
                            original(image, archive)
                    docker.save = save
                    with self.assertRaises(m.Refused): self.package(root, receipts, docker)
                else:
                    with self.assertRaises(m.Refused): self.package(root, receipts, docker, time.monotonic() - 1)
                self.assertFalse((root / 'output/manifest.json').exists())

    def test_receipt_replacement_and_archive_truncation_or_chmod_refuse(self):
        for mode in ('receipt', 'truncate', 'chmod'):
            with fixture() as (root, receipts):
                docker = FakeDocker()
                def save(image, archive):
                    archive.write(PUBLIC)
                    if mode == 'receipt':
                        receipts[0].path.rename(root / 'retained-receipt')
                        receipts[0].path.write_text('{}')
                        receipts[0].path.chmod(0o600)
                    elif mode == 'truncate': os.truncate(archive.path, 1)
                    else: archive.path.chmod(0o644)
                docker.save = save
                with self.assertRaises(m.Refused): self.package(root, receipts, docker)
                self.assertFalse((root / 'output/manifest.json').exists())

    def test_archive_hash_readback_and_output_directory_replacement_refuse(self):
        for mode in ('hash', 'directory'):
            with fixture() as (root, receipts):
                docker = FakeDocker()
                def save(image, archive):
                    archive.write(PUBLIC)
                    if mode == 'hash': archive.hasher.update(b'OWNED_MISMATCH')
                    else:
                        (root / 'output').rename(root / 'retained-output')
                        (root / 'output').mkdir(mode=0o700)
                docker.save = save
                with self.assertRaises(m.Refused): self.package(root, receipts, docker)
                self.assertFalse((root / 'output/manifest.json').exists())

    def test_close_failure_attempts_both_inputs_and_never_creates_manifest(self):
        with fixture() as (root, receipts):
            target, realclose, calls = receipts[0].fd, os.close, []
            def close(fd):
                calls.append(fd)
                realclose(fd)
                if fd == target: raise OSError('OWNED_CLOSE')
            with patch.object(m.os, 'close', side_effect=close):
                with self.assertRaises(m.Refused): self.package(root, receipts)
            self.assertTrue(all(r.fd is None for r in receipts))
            self.assertFalse((root / 'output/manifest.json').exists())
            self.assertIn(target, calls)

    def test_archive_constructor_failure_closes_just_opened_fd(self):
        with fixture() as (root, receipts):
            realopen, opened = os.open, []
            def opening(path, *args):
                fd = realopen(path, *args)
                if Path(path).name == 'backend-image.tar': opened.append(fd)
                return fd
            with patch.object(m.os, 'open', side_effect=opening), patch.object(m.Archive, 'stable', side_effect=m.Refused('OWNED_INIT')):
                with self.assertRaises(m.Refused): self.package(root, receipts)
            self.assertEqual(len(opened), 1)
            with self.assertRaises(OSError): os.fstat(opened[0])

    def test_late_directory_close_failure_is_non_success_and_output_is_consumed(self):
        with fixture() as (root, receipts):
            realopen, realclose, outputfd = os.open, os.close, []
            def opening(path, *args):
                fd = realopen(path, *args)
                if Path(path) == root / 'output': outputfd.append(fd)
                return fd
            def close(fd):
                realclose(fd)
                if outputfd and fd == outputfd[0]: raise OSError('OWNED_LATE_CLOSE')
            with patch.object(m.os, 'open', side_effect=opening), patch.object(m.os, 'close', side_effect=close):
                with self.assertRaises(OSError): self.package(root, receipts)
            # Even a complete-looking manifest cannot replace the required exit0.
            self.assertTrue((root / 'output/manifest.json').exists())
            docker = FakeDocker()
            with self.assertRaises(m.Refused): self.package(root, receipts, docker)
            self.assertEqual(docker.calls, [])

    def test_receipt_json_duplicate_symlink_link_mode_size_and_parent_are_refused(self):
        for mode in ('duplicate', 'symlink', 'hardlink', 'mode', 'large', 'parent'):
            with tempfile.TemporaryDirectory(prefix='.receipt-fixture-', dir=ROOT / 'tests') as td:
                root = Path(td);path = root / 'receipt';path.write_bytes(b'{"a":1,"a":2}' if mode == 'duplicate' else b'{}');path.chmod(0o600)
                if mode == 'symlink': path.rename(root / 'retained');path.symlink_to('retained')
                elif mode == 'hardlink': os.link(path, root / 'link')
                elif mode == 'mode': path.chmod(0o644)
                elif mode == 'large': path.write_bytes(b'X' * 8193)
                elif mode == 'parent':
                    (root / 'alias').symlink_to(root, target_is_directory=True);path = root / 'alias/receipt'
                with self.assertRaises((m.Refused, OSError)): m.Receipt(path)

    def test_fixed_real_stream_uses_clean_env_and_caps_stderr_timeout_and_inspect(self):
        with fixture() as (root, receipts), patch.object(m.shutil, 'which', return_value='/owned/docker'):
            docker = m.Docker(str(root), time.monotonic() + 10)
            self.assertEqual(docker.prefix, ['/owned/docker', '--host', 'unix:///var/run/docker.sock', '--config', str(root)])
            self.assertEqual(docker.env, {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': str(root), 'LANG': 'C'})
            program = ('import json,os,sys\n'
                       'assert "POISON" not in os.environ\n'
                       'assert sys.argv[1:3] in (["image","inspect"],["image","save"])\n'
                       'assert sys.argv[-1]==' + repr(f.IMAGE) + '\n'
                       'sys.stdout.buffer.write(' + repr(json.dumps(FakeDocker().expected).encode()) + ' if sys.argv[2]=="inspect" else ' + repr(PUBLIC) + ')\n')
            docker.prefix = [sys.executable, '-I', '-B', '-c', program]
            with patch.dict(os.environ, {'POISON': 'NO_INHERIT'}): value = self.package(root, receipts, docker)
            self.assertEqual(value['archiveSha256'], hashlib.sha256(PUBLIC).hexdigest())
        for program, reason in [('import os;os.write(2,b"PRIVATE_SENTINEL")', 'DOCKER_STDERR'),
                                ('import os;os.write(1,b"X"*2049)', 'IMAGE_INSPECTION_LIMIT'),
                                ('import sys;sys.exit(23)', 'DOCKER_EXIT'),
                                ('import time;time.sleep(5)', 'PACKAGE_TIMEOUT')]:
            with patch.object(m.shutil, 'which', return_value='/owned/docker'):
                docker = m.Docker('/owned/empty', time.monotonic() + (0.05 if reason == 'PACKAGE_TIMEOUT' else 5))
                docker.prefix = [sys.executable, '-I', '-B', '-c', program]
                with self.assertRaises(m.Refused) as error: docker.inspect(f.IMAGE)
                self.assertEqual(str(error.exception), reason)

    def test_cli_success_output_is_finite_and_failure_never_prints_native_text(self):
        for mode in ('pass', 'exit'):
            with fixture() as (root, receipts):
                # main opens its own held inputs; release fixture descriptors first.
                m.close_all(receipts)
                argv = ['package', '--commit', f.COMMIT, '--metadata', str(root / 'metadata.json'), '--smoke', str(root / 'smoke.json'), '--output', str(root / 'output')]
                with patch.object(m.sys, 'argv', argv), patch.object(m, 'Docker', return_value=FakeDocker(mode)), redirect_stdout(io.StringIO()) as output:
                    code = m.cli()
                value = json.loads(output.getvalue())
                self.assertEqual(code, 0 if mode == 'pass' else 1)
                self.assertLess(len(output.getvalue()), 2048)
                self.assertNotIn('PRIVATE_SENTINEL', output.getvalue())
                if mode == 'exit': self.assertEqual(value, {'status': 'PACKAGE_REFUSED', 'reason': 'DOCKER_EXIT'})

if __name__ == '__main__':
    unittest.main(verbosity=2)
