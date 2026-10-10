import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
test('new bridge selectors compile against installed RNCallKeep public header', {
  skip: process.platform !== 'darwin' ? 'macOS Command Line Tools required' : false,
}, () => {
  const compile = spawnSync('clang', ['-fobjc-arc', '-fblocks', '-Werror=objc-method-access', '-Werror=protocol',
    '-I', path.resolve(root, '../../node_modules/react-native-callkeep/ios'),
    '-I', path.join(root, 'tests/stubs'), '-fsyntax-only', path.join(root, 'ios/Phone11VoipPush.m')], { encoding: 'utf8', timeout: 60000 });
  assert.equal(compile.status, 0, compile.stderr);
});
for (const gate of [0, 1]) test(`actual PushKit bridge: commissioning gate ${gate}, token lifecycle and safe CallKit failure`, {
  skip: process.platform !== 'darwin' ? 'macOS Command Line Tools required' : false,
}, () => {
  const directory = mkdtempSync(path.join(root, '.native-test-'));
  try {
    const executable = path.join(directory, 'native-push');
    const compile = spawnSync('clang', ['-fobjc-arc', '-fblocks', '-Werror=objc-method-access', '-Werror=protocol',
      `-DPHONE11_VOIP_WAKE_COMMISSIONED=${gate}`, '-I', path.join(root, 'tests/stubs'),
      '-framework', 'Foundation', path.join(root, 'tests/native-push.m'), '-o', executable], { encoding: 'utf8', timeout: 60000 });
    assert.equal(compile.status, 0, compile.stderr);
    const result = spawnSync(executable, [], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PASS: \d+ native push assertions/);
    console.log(result.stdout.trim());
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
