import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const framework = path.join(root, 'vendor/siprix.xcframework/ios-arm64');
const base = ['-fobjc-arc', '-fblocks', '-Werror=objc-method-access', '-Werror=protocol',
  '-include', path.join(root, 'tests/stubs/prefix.h'), '-I', path.join(root, 'tests/stubs'), '-F', framework];

function run(args) {
  const result = spawnSync('clang', args, { encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
}

test('gated shared native wake runtime and authenticated adoption with a mock SDK', {
  skip: process.platform !== 'darwin' ? 'macOS Command Line Tools required' : false,
}, () => {
  const out = mkdtempSync(path.join(root, '.native-test-'));
  try {
    const executable = path.join(out, 'native-runtime');
    run([...base, '-Wno-incomplete-implementation', '-framework', 'Foundation',
      path.join(root, 'tests/native-wake-runtime.m'), '-o', executable]);
    const result = spawnSync(executable, [], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    assert.match(result.stdout, /PASS: \d+ native wake runtime assertions/);
    console.log(result.stdout.trim());
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
