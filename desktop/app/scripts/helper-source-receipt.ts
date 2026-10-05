/** Receipt consistency gates; the release operator must establish receipt custody separately. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, readlink, readdir, realpath } from 'node:fs/promises';
import { lstatSync, readFileSync, readlinkSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { helperExecutable, verifyPackagedHelper } from '../src/helper-verifier';

const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Helper source receipt: ${message}`);
}
function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 4_000_000 }).trim();
}
async function readReceipt(path: string): Promise<Buffer> {
  requireValue(isAbsolute(path), 'an absolute receipt path is required');
  const info = await lstat(path);
  requireValue(info.isFile() && info.size > 0 && info.size <= 2_000_000, 'invalid receipt file');
  return readFile(path);
}
function record(value: unknown, message: string): Record<string, unknown> {
  requireValue(object(value), message); return value;
}
async function requireDigest(path: string, expected: unknown, message: string): Promise<void> {
  requireValue(hash(expected) && sha(await readFile(path)) === expected, message);
}
// No awaits in the final pass: local JavaScript callbacks cannot replace an already checked input.
// This is still a sequence of filesystem reads, not an atomic snapshot against external writers.
function requireDigestSync(path: string, expected: unknown, message: string): void {
  const info = lstatSync(path);
  requireValue(info.isFile() && info.size > 0 && info.size <= 100_000_000 &&
    hash(expected) && sha(readFileSync(path)) === expected, message);
}
function requireReceiptSync(path: string, bytes: Buffer, message: string): void {
  const info = lstatSync(path);
  requireValue(info.isFile() && info.size > 0 && info.size <= 2_000_000 &&
    sha(readFileSync(path)) === sha(bytes), message);
}
function requireTreeSync(root: string, files: Record<string, unknown>, links: Record<string, unknown>): void {
  const rootReal = realpathSync(root), actualFiles: string[] = [], actualLinks: string[] = [];
  let bytes = 0;
  function scan(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry), key = relative(root, path).split(sep).join('/'), info = lstatSync(path);
      if (info.isDirectory()) scan(path);
      else if (info.isFile()) {
        bytes += info.size;
        requireValue(bytes <= 500_000_000, 'final inventory is unbounded');
        requireDigestSync(path, files[key], `final inventory bytes mismatch: ${key}`);
        actualFiles.push(key);
      } else if (info.isSymbolicLink()) {
        const target = realpathSync(path);
        requireValue(readlinkSync(path) === links[key] && (target === rootReal || target.startsWith(rootReal + sep)),
          `final inventory link mismatch: ${key}`);
        actualLinks.push(key);
      } else throw new Error('Helper source receipt: unsupported final inventory entry');
      requireValue(actualFiles.length + actualLinks.length <= 5000, 'final inventory is unbounded');
    }
  }
  scan(root);
  requireValue(isDeepStrictEqual(actualFiles.sort(), Object.keys(files).sort()) &&
    isDeepStrictEqual(actualLinks.sort(), Object.keys(links).sort()), 'final inventory set mismatch');
}
function sourceBinding(repoRoot: string): { sourceSha: string; assertCurrent(): void; digest(path: string): string } {
  const sourceSha = git(repoRoot, 'rev-parse', 'HEAD');
  requireValue(/^[a-f0-9]{40}$/.test(sourceSha), 'invalid packaging source');
  const assertCurrent = (): void => {
    requireValue(git(repoRoot, 'rev-parse', 'HEAD') === sourceSha, 'packaging source changed');
    requireValue(!git(repoRoot, 'status', '--porcelain', '--', 'desktop/native') &&
      !git(repoRoot, 'ls-files', '--others', '--', 'desktop/native'), 'native source is not committed and unchanged');
  };
  assertCurrent();
  return { sourceSha, assertCurrent, digest: path => sha(execFileSync('git', ['show', `${sourceSha}:${path}`],
    { cwd: repoRoot, maxBuffer: 4_000_000 })) };
}

export type HelperReceiptGate = { sourceSha: string; assertCurrent(helperPath?: string, copiedDirectory?: string): Promise<void> };

/** Consumes the existing trusted-manual Windows workflow receipt, not a newly minted manifest. */
export async function verifyWindowsHelperSourceReceipt(options: {
  repoRoot: string; sdkRoot: string; sdkRevision: string; helperPath: string; receiptPath: string;
}): Promise<HelperReceiptGate> {
  const source = sourceBinding(options.repoRoot);
  const bytes = await readReceipt(options.receiptPath);
  const receipt = record(JSON.parse(bytes.toString('utf8')), 'invalid Windows receipt');
  requireValue(receipt.version === 1 && receipt.kind === 'phone11-windows-helper-build-bootstrap-only' &&
    receipt.sourceSha === source.sourceSha && receipt.sdkSha === options.sdkRevision && receipt.trialMaxSeconds === 60,
    'Windows receipt does not bind the current source and pinned SDK');
  requireValue(typeof receipt.runId === 'string' && /^[0-9]{1,20}$/.test(receipt.runId) &&
    typeof receipt.runAttempt === 'string' && /^[0-9]{1,10}$/.test(receipt.runAttempt), 'invalid workflow identity');
  const helper = record(receipt.helper, 'missing helper receipt');
  requireValue(helper.file === 'phone11_siprix_helper.exe' && helper.machine === 'AMD64' && helper.format === 'PE32+' &&
    Number.isSafeInteger(helper.bytes) && Number(helper.bytes) > 0 && Number(helper.bytes) <= 100_000_000 && hash(helper.sha256),
    'invalid Windows helper identity');
  const bootstrap = record(receipt.bootstrap, 'missing bootstrap receipt');
  requireValue(bootstrap.passed === true && bootstrap.testSha256 === source.digest('desktop/native/test_bootstrap.py'),
    'bootstrap source mismatch');
  const inputs = record(receipt.inputs, 'missing consumed inputs');
  requireValue(inputs.cppSha256 === source.digest('desktop/native/phone11_siprix_helper.cpp') &&
    inputs.cmakeSha256 === source.digest('desktop/native/CMakeLists.txt'), 'native input source mismatch');
  const vendor = record(inputs.vendorSha256, 'missing vendor inputs');
  requireValue(Object.keys(vendor).sort().join(',') === 'siprix.dll,siprix.lib,siprixMedia.dll', 'invalid vendor input set');
  async function assertCurrent(helperPath = options.helperPath, copiedDirectory?: string): Promise<void> {
    source.assertCurrent();
    requireValue(sha(await readReceipt(options.receiptPath)) === sha(bytes), 'receipt changed during packaging');
    requireValue(git(options.sdkRoot, 'rev-parse', 'HEAD') === options.sdkRevision &&
      !git(options.sdkRoot, 'status', '--porcelain') &&
      !git(options.sdkRoot, 'ls-files', '--others', '--'), 'SDK checkout is not pinned and unchanged');
    await requireDigest(join(options.sdkRoot, 'win/siprix.framework/include/Siprix.h'), inputs.headerSha256, 'SDK header mismatch');
    for (const name of ['siprix.lib', 'siprix.dll', 'siprixMedia.dll'])
      await requireDigest(join(options.sdkRoot, 'win/siprix.framework/lib', name), vendor[name], `SDK input mismatch: ${name}`);
    const info = await lstat(helperPath);
    requireValue(info.isFile() && info.size === helper.bytes, 'helper size mismatch');
    await requireDigest(helperPath, helper.sha256, 'helper bytes mismatch');
    requireReceiptSync(options.receiptPath, bytes, 'receipt changed during packaging');
    requireDigestSync(join(options.sdkRoot, 'win/siprix.framework/include/Siprix.h'), inputs.headerSha256, 'SDK header mismatch');
    for (const name of ['siprix.lib', 'siprix.dll', 'siprixMedia.dll'])
      requireDigestSync(join(options.sdkRoot, 'win/siprix.framework/lib', name), vendor[name], `SDK input mismatch: ${name}`);
    requireValue(lstatSync(helperPath).size === helper.bytes, 'helper size mismatch');
    requireDigestSync(helperPath, helper.sha256, 'helper bytes mismatch');
    if (copiedDirectory !== undefined) {
      const copiedFiles = { 'phone11_siprix_helper.exe': helper.sha256, 'siprix.dll': vendor['siprix.dll'],
        'siprixMedia.dll': vendor['siprixMedia.dll'] };
      requireValue(isAbsolute(copiedDirectory) && lstatSync(copiedDirectory).isDirectory() &&
        resolve(helperPath) === resolve(join(copiedDirectory, 'phone11_siprix_helper.exe')) &&
        isDeepStrictEqual(readdirSync(copiedDirectory).sort(), Object.keys(copiedFiles).sort()),
        'copied Windows helper inventory mismatch');
      for (const [name, digest] of Object.entries(copiedFiles))
        requireDigestSync(join(copiedDirectory, name), digest, `copied Windows input mismatch: ${name}`);
    }
    requireValue(git(options.sdkRoot, 'rev-parse', 'HEAD') === options.sdkRevision &&
      !git(options.sdkRoot, 'status', '--porcelain') &&
      !git(options.sdkRoot, 'ls-files', '--others', '--'), 'SDK checkout is not pinned and unchanged');
    source.assertCurrent();
  }
  await assertCurrent();
  source.assertCurrent();
  return { sourceSha: source.sourceSha, assertCurrent };
}

/** Preserves the existing local Mac native-provenance + input-before receipt format. */
export async function verifyMacHelperSourceReceipt(options: {
  repoRoot: string; stageRoot: string; nativeReceiptPath: string; inputReceiptPath: string;
}): Promise<HelperReceiptGate> {
  const source = sourceBinding(options.repoRoot);
  const nativeBytes = await readReceipt(options.nativeReceiptPath);
  const inputBytes = await readReceipt(options.inputReceiptPath);
  const native = record(JSON.parse(nativeBytes.toString('utf8')), 'invalid Mac native receipt');
  const input = record(JSON.parse(inputBytes.toString('utf8')), 'invalid Mac input receipt');
  requireValue(native.sourceSha === source.sourceSha && input.sourceSha === source.sourceSha &&
    native.inputReceiptSha256 === sha(inputBytes) && native.architecture === 'arm64' &&
    native.trialMaxSeconds === 60 && input.trialMaxSeconds === 60 && native.helperOrAppLaunched === false &&
    input.helperOrAppLaunched === false, 'Mac receipts do not bind current source, linked inputs and trial scope');
  requireValue(hash(native.helperBinarySha256) && Number.isSafeInteger(native.helperBinaryBytes) &&
    Number(native.helperBinaryBytes) > 0 && Number(native.helperBinaryBytes) <= 100_000_000 &&
    hash(native.manifestSha256) && hash(native.configSha256) && hash(input.headerSha256), 'invalid Mac input hashes');
  const nativeInputs = record(native.sourceInputs, 'missing Mac source inputs');
  const priorInputs = record(input.sourceInputs, 'missing linked Mac source inputs');
  const paths = ['desktop/native/phone11_siprix_helper.cpp', 'desktop/native/CMakeLists.txt', 'desktop/app/package-lock.json'];
  for (const path of paths) requireValue(nativeInputs[path] === source.digest(path) && priorInputs[path] === source.digest(path),
    `Mac source input mismatch: ${path}`);
  requireValue(typeof input.sdkInputView === 'string' && isAbsolute(input.sdkInputView), 'missing retained Mac SDK input view');
  const sdkRoot = input.sdkInputView;
  const manifest = record(native.manifest, 'missing complete Mac helper manifest');
  const files = record(manifest.files, 'missing Mac helper files');
  const links = record(manifest.symlinks, 'missing Mac helper links');
  const baseline = record(input.baselineManifest, 'missing retained framework inventory');
  requireValue(manifest.platform === 'darwin' && baseline.platform === 'darwin', 'invalid Mac inventory platform');
  const baselineFiles = record(baseline.files, 'missing retained framework files');
  const baselineLinks = record(baseline.symlinks, 'missing retained framework links');
  const frameworkPrefix = 'phone11_siprix_helper.app/Contents/Frameworks/';
  const frameworkFiles = Object.keys(files).filter(path => path.startsWith(frameworkPrefix));
  requireValue(frameworkFiles.length > 0 &&
    isDeepStrictEqual(frameworkFiles.sort(), Object.keys(baselineFiles).filter(path => path.startsWith(frameworkPrefix)).sort()) &&
    isDeepStrictEqual(Object.fromEntries(Object.entries(links).filter(([path]) => path.startsWith(frameworkPrefix))),
      Object.fromEntries(Object.entries(baselineLinks).filter(([path]) => path.startsWith(frameworkPrefix)))),
    'retained Mac framework inventory mismatch');
  for (const path of frameworkFiles) requireValue(files[path] === baselineFiles[path], 'retained Mac framework bytes mismatch');
  async function assertCurrent(helperPath = helperExecutable(options.stageRoot, 'darwin')): Promise<void> {
    source.assertCurrent();
    requireValue(sha(await readReceipt(options.nativeReceiptPath)) === sha(nativeBytes) &&
      sha(await readReceipt(options.inputReceiptPath)) === sha(inputBytes), 'Mac receipt changed during packaging');
    for (const path of paths) await requireDigest(join(options.repoRoot, path), nativeInputs[path], `Mac source changed: ${path}`);
    // Mac receipts record no bootstrap execution. Bind the committed test input without claiming a smoke result.
    await requireDigest(join(options.repoRoot, 'desktop/native/test_bootstrap.py'), source.digest('desktop/native/test_bootstrap.py'),
      'Mac bootstrap source changed');
    await requireDigest(join(sdkRoot, 'macos/siprix.framework/Headers/SiprixCpp.h'), input.headerSha256, 'Mac SDK header mismatch');
    let resources = helperPath;
    for (let i = 0; i < 6; i++) resources = dirname(resources);
    const manifestBytes = await readFile(join(resources, 'helper-integrity.json'));
    requireValue(sha(manifestBytes) === native.manifestSha256 &&
      isDeepStrictEqual(JSON.parse(manifestBytes.toString('utf8')), manifest), 'Mac full manifest mismatch');
    requireValue(await verifyPackagedHelper(helperPath, resources, native.manifestSha256 as string, 'darwin'),
      'Mac copied helper inventory mismatch');
    await requireDigest(join(resources, 'config.json'), native.configSha256, 'Mac config bytes mismatch');
    const info = await lstat(helperPath);
    requireValue(info.isFile() && info.size === native.helperBinaryBytes, 'Mac helper size mismatch');
    await requireDigest(helperPath, native.helperBinarySha256, 'Mac helper bytes mismatch');
    // A retained SDK view has no Git checkout gate: reject undeclared files that could shadow include inputs.
    const sdkFiles: string[] = [], sdkLinks: string[] = [];
    for (const framework of ['siprix.framework', 'siprixMedia.framework']) {
      const root = join(sdkRoot, 'macos', framework), rootReal = await realpath(root);
      async function scan(dir: string): Promise<void> {
        for (const entry of await readdir(dir)) {
          const path = join(dir, entry), key = frameworkPrefix + framework + '/' + relative(root, path).split(sep).join('/');
          const info = await lstat(path);
          if (info.isDirectory()) await scan(path);
          else if (info.isFile()) sdkFiles.push(key);
          else if (info.isSymbolicLink()) {
            const target = await realpath(path);
            requireValue(target === rootReal || target.startsWith(rootReal + sep), 'Mac SDK link escapes framework');
            sdkLinks.push(key);
          } else throw new Error('Helper source receipt: unsupported Mac SDK entry');
          requireValue(sdkFiles.length + sdkLinks.length <= 5000, 'Mac SDK inventory is unbounded');
        }
      }
      await scan(root);
    }
    requireValue(isDeepStrictEqual(sdkFiles.sort(), frameworkFiles) &&
      isDeepStrictEqual(sdkLinks.sort(), Object.keys(links).filter(path => path.startsWith(frameworkPrefix)).sort()),
      'consumed Mac SDK inventory mismatch');
    for (const [path, target] of Object.entries(links).filter(([path]) => path.startsWith(frameworkPrefix))) {
      const relative = path.slice(frameworkPrefix.length);
      requireValue((relative.startsWith('siprix.framework/') || relative.startsWith('siprixMedia.framework/')) &&
        await readlink(join(sdkRoot, 'macos', relative)) === target, 'consumed Mac framework link mismatch');
    }
    for (const path of frameworkFiles) {
      const relative = path.slice(frameworkPrefix.length);
      // verifyPackagedHelper validates manifest paths before they are used against the retained SDK view.
      requireValue(relative.startsWith('siprix.framework/') || relative.startsWith('siprixMedia.framework/'),
        'unexpected Mac framework input');
      await requireDigest(join(sdkRoot, 'macos', relative), files[path], 'consumed Mac framework mismatch');
    }
    requireReceiptSync(options.nativeReceiptPath, nativeBytes, 'Mac receipt changed during packaging');
    requireReceiptSync(options.inputReceiptPath, inputBytes, 'Mac receipt changed during packaging');
    for (const path of paths) requireDigestSync(join(options.repoRoot, path), nativeInputs[path], `Mac source changed: ${path}`);
    requireDigestSync(join(options.repoRoot, 'desktop/native/test_bootstrap.py'), source.digest('desktop/native/test_bootstrap.py'),
      'Mac bootstrap source changed');
    requireDigestSync(join(sdkRoot, 'macos/siprix.framework/Headers/SiprixCpp.h'), input.headerSha256, 'Mac SDK header mismatch');
    requireDigestSync(join(resources, 'helper-integrity.json'), native.manifestSha256, 'Mac full manifest mismatch');
    requireDigestSync(join(resources, 'config.json'), native.configSha256, 'Mac config bytes mismatch');
    const helperRoot = join(resources, 'helper/mac');
    requireValue(realpathSync(helperRoot) === join(realpathSync(resources), 'helper/mac'), 'Mac helper root changed');
    requireTreeSync(helperRoot, files, links);
    requireValue(lstatSync(helperPath).size === native.helperBinaryBytes && (lstatSync(helperPath).mode & 0o111) !== 0,
      'Mac helper size or executable mode mismatch');
    requireDigestSync(helperPath, native.helperBinarySha256, 'Mac helper bytes mismatch');
    for (const framework of ['siprix.framework', 'siprixMedia.framework']) {
      const prefix = frameworkPrefix + framework + '/';
      requireTreeSync(join(sdkRoot, 'macos', framework),
        Object.fromEntries(Object.entries(files).filter(([path]) => path.startsWith(prefix)).map(([path, value]) => [path.slice(prefix.length), value])),
        Object.fromEntries(Object.entries(links).filter(([path]) => path.startsWith(prefix)).map(([path, value]) => [path.slice(prefix.length), value])));
    }
    source.assertCurrent();
  }
  await assertCurrent();
  source.assertCurrent();
  return { sourceSha: source.sourceSha, assertCurrent };
}
