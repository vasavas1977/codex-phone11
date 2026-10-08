import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fsPromises, { mkdtemp, mkdir, writeFile, copyFile, cp, chmod, symlink, rm } from 'node:fs/promises';
import { writeFileSync, unlinkSync, symlinkSync, renameSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifyWindowsHelperSourceReceipt, verifyMacHelperSourceReceipt } from '../scripts/helper-source-receipt';
import { helperExecutable, verifyPackagedHelper } from '../src/helper-verifier';
import { assertCommittedDesktopSource } from '../scripts/committed-source';
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const git = (root: string, ...args: string[]): string => execFileSync('git', args,
  { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'phone11-provenance-test-'));
  const repoRoot = join(root, 'source'), sdkRoot = join(root, 'sdk');
  const helperPath = join(root, 'phone11_siprix_helper.exe'), receiptPath = join(root, 'integrity-receipt.json');
  async function file(base: string, path: string, value: string): Promise<string> {
    const target = join(base, path); await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, value); return sha(Buffer.from(value));
  }
  async function commit(base: string): Promise<string> {
    git(base, 'init', '-q'); git(base, 'add', '.');
    git(base, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture');
    return git(base, 'rev-parse', 'HEAD');
  }
  const cpp = await file(repoRoot, 'desktop/native/phone11_siprix_helper.cpp', 'current cpp');
  const cmake = await file(repoRoot, 'desktop/native/CMakeLists.txt', 'current cmake');
  const bootstrap = await file(repoRoot, 'desktop/native/test_bootstrap.py', 'current bootstrap');
  const sourceSha = await commit(repoRoot);
  const header = await file(sdkRoot, 'win/siprix.framework/include/Siprix.h', 'header');
  const vendor: Record<string, string> = {};
  for (const name of ['siprix.lib', 'siprix.dll', 'siprixMedia.dll'])
    vendor[name] = await file(sdkRoot, `win/siprix.framework/lib/${name}`, name);
  const sdkRevision = await commit(sdkRoot);
  const helper = Buffer.from('current synthetic helper'); await writeFile(helperPath, helper);
  const receipt = { version: 1, kind: 'phone11-windows-helper-build-bootstrap-only', sourceSha, sdkSha: sdkRevision,
    runId: '1234', runAttempt: '1', trialMaxSeconds: 60,
    helper: { file: 'phone11_siprix_helper.exe', sha256: sha(helper), bytes: helper.length, machine: 'AMD64', format: 'PE32+' },
    bootstrap: { passed: true, testSha256: bootstrap },
    inputs: { cppSha256: cpp, cmakeSha256: cmake, headerSha256: header, vendorSha256: vendor } };
  const save = () => writeFile(receiptPath, JSON.stringify(receipt)); await save();
  return { root, repoRoot, sdkRoot, sdkRevision, helperPath, receiptPath, receipt, save,
    cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('valid current workflow receipt binds actual source, SDK and helper bytes', async () => {
  const f = await fixture(); try {
    const gate = await verifyWindowsHelperSourceReceipt(f);
    assert.equal(gate.sourceSha, f.receipt.sourceSha);
    const copy = join(f.root, 'copied-helper.exe'); await copyFile(f.helperPath, copy);
    await gate.assertCurrent(copy);
  } finally { await f.cleanup(); }
});

for (const [name, change] of Object.entries({
  'stale source': (f: Awaited<ReturnType<typeof fixture>>) => { f.receipt.sourceSha = '0'.repeat(40); },
  'wrong cpp': (f: Awaited<ReturnType<typeof fixture>>) => { f.receipt.inputs.cppSha256 = '0'.repeat(64); },
  'wrong cmake': (f: Awaited<ReturnType<typeof fixture>>) => { f.receipt.inputs.cmakeSha256 = '0'.repeat(64); },
  'wrong header': (f: Awaited<ReturnType<typeof fixture>>) => { f.receipt.inputs.headerSha256 = '0'.repeat(64); },
  'wrong import lib': (f: Awaited<ReturnType<typeof fixture>>) => { f.receipt.inputs.vendorSha256['siprix.lib'] = '0'.repeat(64); },
  'wrong runtime DLL': (f: Awaited<ReturnType<typeof fixture>>) => { f.receipt.inputs.vendorSha256['siprix.dll'] = '0'.repeat(64); },
  'wrong media DLL': (f: Awaited<ReturnType<typeof fixture>>) => { f.receipt.inputs.vendorSha256['siprixMedia.dll'] = '0'.repeat(64); },
  'wrong bootstrap source': (f: Awaited<ReturnType<typeof fixture>>) => { f.receipt.bootstrap.testSha256 = '0'.repeat(64); },
  'failed bootstrap': (f: Awaited<ReturnType<typeof fixture>>) => { f.receipt.bootstrap.passed = false; },
  'wrong SDK': (f: Awaited<ReturnType<typeof fixture>>) => { f.receipt.sdkSha = '0'.repeat(40); },
  'wrong helper bytes': (f: Awaited<ReturnType<typeof fixture>>) => { f.receipt.helper.sha256 = '0'.repeat(64); },
  'wrong architecture': (f: Awaited<ReturnType<typeof fixture>>) => { f.receipt.helper.machine = 'ARM64'; },
  'wrong helper size': (f: Awaited<ReturnType<typeof fixture>>) => { f.receipt.helper.bytes++; },
  'wrong receipt kind': (f: Awaited<ReturnType<typeof fixture>>) => { f.receipt.kind = 'macos'; },
  'missing workflow identity': (f: Awaited<ReturnType<typeof fixture>>) => { f.receipt.runId = ''; },
})) test(`reject ${name}`, async () => {
  const f = await fixture(); try { change(f); await f.save(); await assert.rejects(verifyWindowsHelperSourceReceipt(f)); }
  finally { await f.cleanup(); }
});

test('old integrity-only gate accepts self-consistent replacement helper; source receipt rejects it', async () => {
  const f = await fixture(); try {
    const stage = join(f.root, 'stage'), dir = join(stage, 'helper/win'); await mkdir(dir, { recursive: true });
    const files: Record<string, string> = {};
    for (const name of ['phone11_siprix_helper.exe', 'siprix.dll', 'siprixMedia.dll']) {
      const value = Buffer.from(name === 'phone11_siprix_helper.exe' ? 'historical wrong helper!!' : name);
      await writeFile(join(dir, name), value); files[name] = sha(value);
    }
    const manifest = Buffer.from(JSON.stringify({ platform: 'win32', files, symlinks: {} }));
    await writeFile(join(stage, 'helper-integrity.json'), manifest);
    const wrongHelper = join(dir, 'phone11_siprix_helper.exe');
    assert.equal(await verifyPackagedHelper(wrongHelper, stage, sha(manifest), 'win32'), true);
    await assert.rejects(verifyWindowsHelperSourceReceipt({ ...f, helperPath: wrongHelper }), /helper (size|bytes) mismatch/);
  } finally { await f.cleanup(); }
});

test('missing receipt fails before a package can be built', async () => {
  const f = await fixture(); try { await rm(f.receiptPath); await assert.rejects(verifyWindowsHelperSourceReceipt(f)); }
  finally { await f.cleanup(); }
});

for (const flag of ['--assume-unchanged', '--skip-worktree'])
  test(`Windows accepts unchanged native inputs with ${flag}`, async () => {
    const f = await fixture(); try {
      git(f.repoRoot, 'update-index', flag, 'desktop/native/phone11_siprix_helper.cpp',
        'desktop/native/CMakeLists.txt', 'desktop/native/test_bootstrap.py');
      const gate = await verifyWindowsHelperSourceReceipt(f);
      await gate.assertCurrent();
    } finally { await f.cleanup(); }
  });

for (const flag of ['--assume-unchanged', '--skip-worktree'])
  for (const path of ['desktop/native/phone11_siprix_helper.cpp', 'desktop/native/CMakeLists.txt', 'desktop/native/test_bootstrap.py'])
    test(`Windows rejects ${flag} native input modification: ${path}`, async () => {
      const f = await fixture(); try {
        git(f.repoRoot, 'update-index', flag, path);
        await writeFile(join(f.repoRoot, path), 'modified native input hidden from git status');
        assert.equal(git(f.repoRoot, 'status', '--porcelain', '--', 'desktop/native'), '',
          'Git status cannot establish the worktree input bytes for this index flag');
        await assert.rejects(verifyWindowsHelperSourceReceipt(f), /native source input changed/);
      } finally { await f.cleanup(); }
    });

for (const mutation of ['receipt', 'helper', 'header', 'sdk', 'source', 'untracked-native', 'copied-helper', 'head'])
  test(`snapshot rejects changed ${mutation} at the later package boundary`, async () => {
    const f = await fixture(); try {
      const gate = await verifyWindowsHelperSourceReceipt(f);
      const copy = join(f.root, 'copied.exe'); await copyFile(f.helperPath, copy);
      if (mutation === 'receipt') await writeFile(f.receiptPath, JSON.stringify({ ...f.receipt, runId: '999' }));
      if (mutation === 'helper') await writeFile(f.helperPath, 'replaced');
      if (mutation === 'header') await writeFile(join(f.sdkRoot, 'win/siprix.framework/include/Siprix.h'), 'changed');
      if (mutation === 'sdk') await writeFile(join(f.sdkRoot, 'untracked'), 'changed');
      if (mutation === 'source') await writeFile(join(f.repoRoot, 'desktop/native/phone11_siprix_helper.cpp'), 'changed');
      if (mutation === 'untracked-native') await writeFile(join(f.repoRoot, 'desktop/native/untracked.h'), 'changed');
      if (mutation === 'copied-helper') await writeFile(copy, 'replaced');
      if (mutation === 'head') git(f.repoRoot, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-qm', 'new head');
      await assert.rejects(gate.assertCurrent(mutation === 'copied-helper' ? copy : undefined));
    } finally { await f.cleanup(); }
  });


async function macFixture() {
  const f = await fixture();
  await mkdir(join(f.repoRoot, 'desktop/app'), { recursive: true });
  const lock = Buffer.from('current package lock'); await writeFile(join(f.repoRoot, 'desktop/app/package-lock.json'), lock);
  git(f.repoRoot, 'add', '.'); git(f.repoRoot, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'lock');
  const sourceSha = git(f.repoRoot, 'rev-parse', 'HEAD');
  const stageRoot = join(f.root, 'mac-stage'), sdkInputView = join(f.root, 'mac-sdk');
  const helperPath = join(stageRoot, 'helper/mac/phone11_siprix_helper.app/Contents/MacOS/phone11_siprix_helper');
  const helper = Buffer.from('current mac helper');
  await mkdir(join(helperPath, '..'), { recursive: true }); await writeFile(helperPath, helper); await chmod(helperPath, 0o700);
  const files: Record<string, string> = { 'phone11_siprix_helper.app/Contents/MacOS/phone11_siprix_helper': sha(helper) };
  let headerSha256 = '';
  for (const path of ['siprix.framework/siprix', 'siprix.framework/Headers/SiprixCpp.h', 'siprixMedia.framework/siprixMedia']) {
    const value = Buffer.from(`mac SDK ${path}`);
    for (const root of [join(stageRoot, 'helper/mac/phone11_siprix_helper.app/Contents/Frameworks'), join(sdkInputView, 'macos')]) {
      await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), value);
    }
    files[`phone11_siprix_helper.app/Contents/Frameworks/${path}`] = sha(value);
    if (path.endsWith('SiprixCpp.h')) headerSha256 = sha(value);
  }
  const symlinks = { 'phone11_siprix_helper.app/Contents/Frameworks/siprix.framework/alias': 'siprix' };
  await symlink('siprix', join(stageRoot, 'helper/mac/phone11_siprix_helper.app/Contents/Frameworks/siprix.framework/alias'));
  await symlink('siprix', join(sdkInputView, 'macos/siprix.framework/alias'));
  const manifest = { platform: 'darwin', files, symlinks };
  const manifestBytes = Buffer.from(JSON.stringify(manifest)); await writeFile(join(stageRoot, 'helper-integrity.json'), manifestBytes);
  const config = Buffer.from(JSON.stringify({ apiOrigin: 'https://api.phone11.example/' })); await writeFile(join(stageRoot, 'config.json'), config);
  const sourceInputs = { 'desktop/native/phone11_siprix_helper.cpp': f.receipt.inputs.cppSha256,
    'desktop/native/CMakeLists.txt': f.receipt.inputs.cmakeSha256, 'desktop/app/package-lock.json': sha(lock) };
  const input = { sourceSha, sourceInputs: { ...sourceInputs }, sdkInputView, headerSha256,
    baselineManifest: structuredClone(manifest), trialMaxSeconds: 60, helperOrAppLaunched: false };
  const native = { sourceSha, sourceInputs: { ...sourceInputs }, inputReceiptSha256: '', architecture: 'arm64',
    helperBinarySha256: sha(helper), helperBinaryBytes: helper.length, manifestSha256: sha(manifestBytes),
    manifest: structuredClone(manifest), configSha256: sha(config), trialMaxSeconds: 60, helperOrAppLaunched: false };
  const nativeReceiptPath = join(f.root, 'native-provenance.json'), inputReceiptPath = join(f.root, 'input-before.json');
  const save = async () => {
    const inputBytes = Buffer.from(JSON.stringify(input)); native.inputReceiptSha256 = sha(inputBytes);
    await writeFile(inputReceiptPath, inputBytes); await writeFile(nativeReceiptPath, JSON.stringify(native));
  }; await save();
  return { ...f, stageRoot, helperPath, nativeReceiptPath, inputReceiptPath, input, native, save };
}

test('complete current Mac two-receipt contract accepts exact staged and copied inputs', async () => {
  const f = await macFixture(); try {
    const gate = await verifyMacHelperSourceReceipt(f);
    const copy = join(f.root, 'mac-copy'); await cp(f.stageRoot, copy, { recursive: true, verbatimSymlinks: true });
    await gate.assertCurrent(join(copy, 'helper/mac/phone11_siprix_helper.app/Contents/MacOS/phone11_siprix_helper'));
  } finally { await f.cleanup(); }
});
for (const mutation of ['source', 'input-source', 'cpp', 'lock', 'input-cpp', 'header', 'framework', 'framework-link', 'unlisted-sdk-header', 'helper', 'helper-size', 'manifest', 'config', 'inventory', 'inventory-platform', 'scope'])
  test(`Mac rejects self-consistent wrong ${mutation} receipt`, async () => {
    const f = await macFixture(); try {
      if (mutation === 'source') f.native.sourceSha = '0'.repeat(40);
      if (mutation === 'input-source') f.input.sourceSha = '0'.repeat(40);
      if (mutation === 'cpp') f.native.sourceInputs['desktop/native/phone11_siprix_helper.cpp'] = '0'.repeat(64);
      if (mutation === 'lock') f.native.sourceInputs['desktop/app/package-lock.json'] = '0'.repeat(64);
      if (mutation === 'input-cpp') f.input.sourceInputs['desktop/native/phone11_siprix_helper.cpp'] = '0'.repeat(64);
      if (mutation === 'header') f.input.headerSha256 = '0'.repeat(64);
      if (mutation === 'framework') await writeFile(join(f.input.sdkInputView, 'macos/siprix.framework/siprix'), 'wrong consumed SDK');
      if (mutation === 'framework-link') {
        const link = join(f.input.sdkInputView, 'macos/siprix.framework/alias'); await rm(link); await symlink('Headers/SiprixCpp.h', link);
      }
      if (mutation === 'unlisted-sdk-header') await writeFile(join(f.input.sdkInputView, 'macos/siprix.framework/Headers/memory'), 'shadow include');
      if (mutation === 'helper-size') f.native.helperBinaryBytes++;
      if (mutation === 'helper') f.native.helperBinarySha256 = '0'.repeat(64);
      if (mutation === 'manifest') f.native.manifestSha256 = '0'.repeat(64);
      if (mutation === 'config') f.native.configSha256 = '0'.repeat(64);
      if (mutation === 'inventory') delete f.input.baselineManifest.files['phone11_siprix_helper.app/Contents/Frameworks/siprix.framework/siprix'];
      if (mutation === 'inventory-platform') f.input.baselineManifest.platform = 'win32';
      if (mutation === 'scope') f.native.helperOrAppLaunched = true;
      await f.save(); await assert.rejects(verifyMacHelperSourceReceipt(f));
    } finally { await f.cleanup(); }
  });

test('Mac rejects missing and incorrectly linked original input receipt', async () => {
  const f = await macFixture(); try {
    f.native.inputReceiptSha256 = '0'.repeat(64); await writeFile(f.nativeReceiptPath, JSON.stringify(f.native));
    await assert.rejects(verifyMacHelperSourceReceipt(f));
    await rm(f.inputReceiptPath); await assert.rejects(verifyMacHelperSourceReceipt(f));
  } finally { await f.cleanup(); }
});

for (const mutation of ['native-receipt', 'input-receipt', 'helper', 'copied-framework', 'copied-config', 'header', 'lock', 'bootstrap', 'head'])
  test(`Mac snapshot rejects later ${mutation} change`, async () => {
    const f = await macFixture(); try {
      const gate = await verifyMacHelperSourceReceipt(f), copy = join(f.root, 'mac-copy');
      await cp(f.stageRoot, copy, { recursive: true, verbatimSymlinks: true });
      const copiedHelper = join(copy, 'helper/mac/phone11_siprix_helper.app/Contents/MacOS/phone11_siprix_helper');
      if (mutation === 'native-receipt') await writeFile(f.nativeReceiptPath, '{}');
      if (mutation === 'input-receipt') await writeFile(f.inputReceiptPath, '{}');
      if (mutation === 'helper') await writeFile(copiedHelper, 'replaced helper');
      if (mutation === 'copied-framework') await writeFile(join(copy, 'helper/mac/phone11_siprix_helper.app/Contents/Frameworks/siprix.framework/siprix'), 'replaced SDK');
      if (mutation === 'copied-config') await writeFile(join(copy, 'config.json'), '{}');
      if (mutation === 'header') await writeFile(join(f.input.sdkInputView, 'macos/siprix.framework/Headers/SiprixCpp.h'), 'changed');
      if (mutation === 'lock') await writeFile(join(f.repoRoot, 'desktop/app/package-lock.json'), 'changed');
      if (mutation === 'bootstrap') await writeFile(join(f.repoRoot, 'desktop/native/test_bootstrap.py'), 'changed');
      if (mutation === 'head') git(f.repoRoot, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-qm', 'new head');
      await assert.rejects(gate.assertCurrent(copiedHelper));
    } finally { await f.cleanup(); }
  });


test('old Mac integrity gate accepts replacement helper with a reminted manifest; source receipt refuses it', async () => {
  const f = await macFixture(); try {
    const bytes = Buffer.from('historical helper'); await writeFile(f.helperPath, bytes);
    const manifest = structuredClone(f.native.manifest); manifest.files['phone11_siprix_helper.app/Contents/MacOS/phone11_siprix_helper'] = sha(bytes);
    const manifestBytes = Buffer.from(JSON.stringify(manifest)); await writeFile(join(f.stageRoot, 'helper-integrity.json'), manifestBytes);
    assert.equal(await verifyPackagedHelper(f.helperPath, f.stageRoot, sha(manifestBytes), 'darwin'), true);
    await assert.rejects(verifyMacHelperSourceReceipt(f));
  } finally { await f.cleanup(); }
});

test('Mac rejects absent native receipt without inventing a producer attestation', async () => {
  const f = await macFixture(); try { await rm(f.nativeReceiptPath); await assert.rejects(verifyMacHelperSourceReceipt(f)); }
  finally { await f.cleanup(); }
});


async function rejectHeadDuringCheck(gate: Awaited<ReturnType<typeof verifyWindowsHelperSourceReceipt>>, repoRoot: string): Promise<void> {
  const attempt = gate.assertCurrent();
  queueMicrotask(() => git(repoRoot, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test',
    'commit', '--allow-empty', '-qm', 'persistent new HEAD during awaits'));
  await assert.rejects(attempt, /packaging source changed/);
}
test('Windows rejects persistent HEAD change during awaited final gate', async () => {
  const f = await fixture(); try { await rejectHeadDuringCheck(await verifyWindowsHelperSourceReceipt(f), f.repoRoot); }
  finally { await f.cleanup(); }
});
test('Mac rejects persistent HEAD change during awaited final gate', async () => {
  const f = await macFixture(); try { await rejectHeadDuringCheck(await verifyMacHelperSourceReceipt(f), f.repoRoot); }
  finally { await f.cleanup(); }
});

// Mutate only after the last awaited input was read, so earlier checks cannot detect the change.
async function afterRead(path: string, mutate: () => void, attempt: () => Promise<void>): Promise<void> {
  const original = fsPromises.readFile;
  let changed = false;
  fsPromises.readFile = (async (...args: Parameters<typeof original>) => {
    const bytes = await original(...args);
    if (!changed && args[0] === path) { changed = true; mutate(); }
    return bytes;
  }) as typeof original;
  syncBuiltinESMExports();
  try { await assert.rejects(attempt()); assert.equal(changed, true, 'mutation hook actually ran'); }
  finally { fsPromises.readFile = original; syncBuiltinESMExports(); }
}
for (const mutation of ['receipt', 'sdk-head', 'sdk-header', 'sdk-dll', 'helper', 'native-cpp', 'native-cmake', 'native-bootstrap'])
  test(`Windows rejects persistent ${mutation} replacement after awaited input checks`, async () => {
    const f = await fixture(); try {
      const gate = await verifyWindowsHelperSourceReceipt(f);
      await afterRead(f.helperPath, () => {
        if (mutation === 'receipt') writeFileSync(f.receiptPath, '{}');
        if (mutation === 'sdk-head') git(f.sdkRoot, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test',
          'commit', '--allow-empty', '-qm', 'persistent SDK HEAD');
        if (mutation === 'sdk-header') writeFileSync(join(f.sdkRoot, 'win/siprix.framework/include/Siprix.h'), 'changed');
        if (mutation === 'sdk-dll') writeFileSync(join(f.sdkRoot, 'win/siprix.framework/lib/siprix.dll'), 'changed');
        if (mutation === 'helper') writeFileSync(f.helperPath, 'changed');
        const nativePath = { 'native-cpp': 'desktop/native/phone11_siprix_helper.cpp',
          'native-cmake': 'desktop/native/CMakeLists.txt', 'native-bootstrap': 'desktop/native/test_bootstrap.py' }[mutation];
        if (nativePath) {
          git(f.repoRoot, 'update-index', '--assume-unchanged', nativePath);
          writeFileSync(join(f.repoRoot, nativePath), 'changed native input after final await');
        }
      }, () => gate.assertCurrent());
    } finally { await f.cleanup(); }
  });
for (const mutation of ['native-receipt', 'input-receipt', 'sdk-header', 'sdk-extra-file', 'sdk-link', 'sdk-framework',
  'copied-helper', 'copied-config', 'lock'])
  test(`Mac rejects persistent ${mutation} replacement after awaited input checks`, async () => {
    const f = await macFixture(); try {
      const gate = await verifyMacHelperSourceReceipt(f);
      const lastInput = join(f.input.sdkInputView, 'macos/siprixMedia.framework/siprixMedia');
      await afterRead(lastInput, () => {
        if (mutation === 'native-receipt') writeFileSync(f.nativeReceiptPath, '{}');
        if (mutation === 'input-receipt') writeFileSync(f.inputReceiptPath, '{}');
        if (mutation === 'sdk-header') writeFileSync(join(f.input.sdkInputView, 'macos/siprix.framework/Headers/SiprixCpp.h'), 'changed');
        if (mutation === 'sdk-extra-file') writeFileSync(join(f.input.sdkInputView, 'macos/siprix.framework/Headers/memory'), 'shadow include');
        if (mutation === 'sdk-link') {
          const link = join(f.input.sdkInputView, 'macos/siprix.framework/alias');
          unlinkSync(link); symlinkSync('Headers/SiprixCpp.h', link);
        }
        if (mutation === 'sdk-framework') writeFileSync(lastInput, 'changed');
        if (mutation === 'copied-helper') writeFileSync(f.helperPath, 'changed');
        if (mutation === 'copied-config') writeFileSync(join(f.stageRoot, 'config.json'), '{}');
        if (mutation === 'lock') writeFileSync(join(f.repoRoot, 'desktop/app/package-lock.json'), 'changed');
      }, () => gate.assertCurrent());
    } finally { await f.cleanup(); }
  });


for (const mutation of ['none', 'head', 'receipt', 'sdk-head', 'sdk-header', 'sdk-dll', 'copied-sdk-dll', 'copied-media-dll', 'copied-extra', 'copied-missing', 'copied-symlink', 'copied-parent-symlink', 'aliased-base', 'manifest-bytes', 'manifest-leaf-link', 'manifest-missing'])
  test(`actual Windows success tail ${mutation === 'none' ? 'accepts current inputs' : mutation === 'aliased-base' ? 'accepts aliased base inputs' : `rejects persistent ${mutation} during final lstat`}`, async () => {
    const f = await fixture(), original = fsPromises.lstat;
    try {
      let base = f.root;
      if (mutation === 'aliased-base') {
        const actual = join(f.root, 'actual-base'); await mkdir(actual);
        base = join(f.root, 'base-alias'); await symlink(actual, base);
      }
      const appPath = join(base, 'fixture-package'), resources = join(appPath, 'resources');
      const packaged = join(resources, 'phone11'), helperDir = join(packaged, 'helper/win');
      await mkdir(helperDir, { recursive: true });
      const files: Record<string, string> = {};
      for (const name of ['phone11_siprix_helper.exe', 'siprix.dll', 'siprixMedia.dll']) {
        const from = name.endsWith('.exe') ? f.helperPath : join(f.sdkRoot, 'win/siprix.framework/lib', name);
        const bytes = await fsPromises.readFile(from);
        await writeFile(join(helperDir, name), bytes); files[name] = sha(bytes);
      }
      const manifest = Buffer.from(JSON.stringify({ platform: 'win32', files, symlinks: {} })), pin = sha(manifest);
      await writeFile(join(packaged, 'helper-integrity.json'), manifest);
      await writeFile(join(resources, 'app.asar'), pin);
      const executable = join(appPath, 'Phone11-Desktop-Trial.exe'); await writeFile(executable, 'fixture only, never executed');
      const provenance = await verifyWindowsHelperSourceReceipt(f), outputs: string[] = [];
      let inspected = false;
      fsPromises.lstat = (async (...args: Parameters<typeof original>) => {
        const result = await original(...args);
        if (!inspected && args[0] === executable) {
          inspected = true;
          if (mutation === 'head' || mutation === 'sdk-head') git(mutation === 'head' ? f.repoRoot : f.sdkRoot,
            '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-qm', 'persistent tail HEAD');
          if (mutation === 'receipt') writeFileSync(f.receiptPath, '{}');
          if (mutation === 'sdk-header') writeFileSync(join(f.sdkRoot, 'win/siprix.framework/include/Siprix.h'), 'changed');
          if (mutation === 'sdk-dll') writeFileSync(join(f.sdkRoot, 'win/siprix.framework/lib/siprix.dll'), 'changed');
          if (mutation === 'copied-sdk-dll') writeFileSync(join(helperDir, 'siprix.dll'), 'changed');
          if (mutation === 'copied-media-dll') writeFileSync(join(helperDir, 'siprixMedia.dll'), 'changed');
          if (mutation === 'copied-extra') writeFileSync(join(helperDir, 'shadow.dll'), 'unlisted');
          if (mutation === 'copied-missing') unlinkSync(join(helperDir, 'siprix.dll'));
          if (mutation === 'manifest-bytes') writeFileSync(join(packaged, 'helper-integrity.json'), '{}');
          if (mutation === 'manifest-missing') unlinkSync(join(packaged, 'helper-integrity.json'));
          if (mutation === 'manifest-leaf-link') {
            const external = join(f.root, 'outside-manifest');
            renameSync(join(packaged, 'helper-integrity.json'), external);
            symlinkSync(external, join(packaged, 'helper-integrity.json'));
          }
          if (mutation === 'copied-parent-symlink') {
            const external = join(f.root, 'outside-helper');
            renameSync(join(packaged, 'helper'), external); symlinkSync(external, join(packaged, 'helper'));
          }
          if (mutation === 'copied-symlink') {
            unlinkSync(join(helperDir, 'siprix.dll'));
            symlinkSync(join(f.sdkRoot, 'win/siprix.framework/lib/siprix.dll'), join(helperDir, 'siprix.dll'));
          }
        }
        return result;
      }) as typeof original;
      syncBuiltinESMExports();
      // Execute only the actual success tail with fixture inputs; never invoke main, build or packager.
      const source = await fsPromises.readFile(join(__dirname, '../scripts/package-windows-local.ts'), 'utf8');
      const start = source.indexOf("    const packaged = join(resources, 'phone11');");
      const write = source.indexOf('    process.stdout.write(', start), end = source.indexOf('\n', write);
      assert.ok(start >= 0 && write > start && end > write, 'actual package success tail is present');
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const tail = new AsyncFunction('provenance', 'helperExecutable', 'assertCommittedDesktopSource', 'repoRoot',
        'verifyPackagedHelper', 'pin', 'readFile', 'join', 'resources', 'lstat', 'appPath', 'process', source.slice(start, end));
      const attempt = tail(provenance, helperExecutable, assertCommittedDesktopSource, f.repoRoot, verifyPackagedHelper,
        pin, fsPromises.readFile, join, resources, fsPromises.lstat, appPath, { stdout: { write: (value: string) => outputs.push(value) } });
      if (mutation === 'none' || mutation === 'aliased-base') {
        await attempt; assert.deepEqual(outputs, [`${appPath}\n`]);
        assert.equal(await verifyPackagedHelper(helperExecutable(packaged, 'win32'), packaged, pin, 'win32'), true,
          'accepted copied inputs still satisfy the actual loader verifier');
      }
      else { await assert.rejects(attempt); assert.deepEqual(outputs, []); }
      assert.equal(inspected, true, 'mutation boundary actually ran');
      if (mutation.startsWith('copied-') || mutation.startsWith('manifest-'))
        assert.equal(await verifyPackagedHelper(helperExecutable(packaged, 'win32'), packaged, pin, 'win32'), false,
          'the actual loader also rejects the persistent copied-input substitution');
    } finally { fsPromises.lstat = original; syncBuiltinESMExports(); await f.cleanup(); }
  });
