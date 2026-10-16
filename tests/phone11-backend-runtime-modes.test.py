"""Owned public mode fixture; no Docker, image, actual UID1001 process or app."""
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).absolute().parent.parent


class RuntimeModes(unittest.TestCase):
    def test_public_copy_modes_become_readable_without_changing_private_context_or_adding_write(self):
        with tempfile.TemporaryDirectory(prefix='.runtime-mode-fixture-', dir=ROOT / 'tests') as directory:
            context = Path(directory, 'private-context')
            context.mkdir(mode=0o700)
            (context / 'modules').mkdir(mode=0o700)
            (context / 'modules/public.js').write_text('// owned public fixture\n')
            (context / 'modules/public.js').chmod(0o600)
            (context / 'package.json').write_text('{}\n')
            (context / 'package.json').chmod(0o600)
            (context / 'public-executable').write_text('#!/bin/sh\nexit 0\n')
            (context / 'public-executable').chmod(0o777)
            runtime = Path(directory, 'public-runtime')
            shutil.copytree(context, runtime, copy_function=shutil.copy2)
            self.assertEqual(stat.S_IMODE(runtime.stat().st_mode), 0o700)
            self.assertFalse((runtime / 'package.json').stat().st_mode & stat.S_IROTH)
            result = subprocess.run(['/bin/chmod', '-R', 'a+rX,go-w', str(runtime)], capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stderr, b'')
            self.assertEqual(stat.S_IMODE(context.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE((context / 'package.json').stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE((context / 'public-executable').stat().st_mode), 0o777)
            for path in [runtime, *runtime.rglob('*')]:
                mode = path.stat().st_mode
                self.assertTrue(mode & stat.S_IROTH)
                self.assertFalse(mode & (stat.S_IWGRP | stat.S_IWOTH))
                if path.is_dir():
                    self.assertTrue(mode & stat.S_IXOTH)
            self.assertEqual(stat.S_IMODE((runtime / 'package.json').stat().st_mode), 0o644)
            self.assertEqual(stat.S_IMODE((runtime / 'public-executable').stat().st_mode), 0o755)

    def test_real_build_checks_public_assets_under_runtime_user_with_network_disabled(self):
        docker = (ROOT / 'infra/docker/backend/Dockerfile').read_text()
        public_chmod = docker.index('RUN chmod -R a+rX,go-w /app')
        self.assertGreater(public_chmod, docker.index('COPY package.json ./', docker.index(' AS production\n')))
        runtime = docker.split('USER cloudphone\n', 1)[1]
        self.assertIn('RUN --network=none node -e', runtime)
        for value in ['fs.constants.R_OK', 'fs.constants.X_OK', 'fs.constants.W_OK', '@jsquash/jpeg', '@jsquash/webp', 'mozjpeg_dec.wasm', 'webp_dec.wasm', './modules/phone11-siprix']:
            self.assertIn(value, runtime)
        self.assertNotIn('chmod', runtime)
        self.assertIn('CMD ["node", "dist/index.mjs"]', runtime)


if __name__ == '__main__':
    unittest.main(verbosity=2)
