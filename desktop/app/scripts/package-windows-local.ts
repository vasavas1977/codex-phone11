/** Build an unsigned Windows x64 trial directory on macOS from an externally built helper. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { packager } from '@electron/packager';
import { helperExecutable, verifyPackagedHelper } from '../src/helper-verifier';
import { assertCommittedDesktopSource } from './committed-source';

const sdkRevision = '38fe11b14fb80c40bef725bbb61e6b1ea42a0d4f';
const sdkDllHashes: Record<string, string> = {
  'siprix.dll': '55869c2f83b8ca08659e1ecd40d7542b54563ed8452bb1a49a1fa9d80eeb2cd4',
  'siprixMedia.dll': '0ebd1bddf590002a83c0059e4064bbae80e91bbd9827a68546280af45452887b',
};
const appRoot = resolve(__dirname, '..');
const repoRoot = resolve(appRoot, '..', '..');
const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

function requireAbsolute(name: string): string {
  const value = process.env[name];
  if (!value || !isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return resolve(value);
}

async function requireX64Pe(path: string, dll: boolean): Promise<void> {
  const bytes = await readFile(path);
  const offset = bytes.length >= 0x40 ? bytes.readUInt32LE(0x3c) : -1;
  if (bytes.toString('ascii', 0, 2) !== 'MZ' || offset < 0 || offset + 26 > bytes.length ||
      bytes.toString('ascii', offset, offset + 4) !== 'PE\0\0' ||
      bytes.readUInt16LE(offset + 4) !== 0x8664 ||
      bytes.readUInt16LE(offset + 24) !== 0x20b ||
      Boolean(bytes.readUInt16LE(offset + 22) & 0x2000) !== dll)
    throw new Error(`Expected Windows x64 ${dll ? 'DLL' : 'EXE'}: ${path}`);
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('This cross-package path requires macOS arm64');
  const sdk = await realpath(requireAbsolute('PHONE11_SIPRIX_SDK_ROOT'));
  const helper = await realpath(requireAbsolute('PHONE11_WINDOWS_HELPER_EXE'));
  const output = await realpath(requireAbsolute('PHONE11_PACKAGE_OUTPUT'));
  if (!(await lstat(output)).isDirectory()) throw new Error('PHONE11_PACKAGE_OUTPUT must be a directory');
  const repoReal = await realpath(repoRoot);
  const apiOrigin = process.env.PHONE11_API_ORIGIN;
  if (!apiOrigin) throw new Error('PHONE11_API_ORIGIN is required');
  const origin = new URL(apiOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' ||
      origin.search || origin.hash || origin.toString() !== apiOrigin)
    throw new Error('PHONE11_API_ORIGIN must be an HTTPS origin without a path or credentials');
  const within = (root: string, path: string): boolean => path === root || path.startsWith(`${root}${sep}`);
  if ([sdk, helper, output].some(path => within(repoReal, path)) || within(sdk, output) ||
      within(output, sdk) || within(output, helper))
    throw new Error('Vendor inputs and output must stay outside the source tree and each other');
  const revision = execFileSync('git', ['-C', sdk, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (revision !== sdkRevision) throw new Error(`SiprixUA SDK must be pinned to ${sdkRevision}`);
  const lib = join(sdk, 'win', 'siprix.framework', 'lib');
  const files: Record<string, string> = {};
  await requireX64Pe(helper, false);
  files['phone11_siprix_helper.exe'] = sha(await readFile(helper));
  for (const [name, expected] of Object.entries(sdkDllHashes)) {
    const path = join(lib, name);
    await requireX64Pe(path, true);
    if (sha(await readFile(path)) !== expected) throw new Error(`Pinned Siprix SDK DLL hash mismatch: ${name}`);
    files[name] = expected;
  }
  const stage = await mkdtemp(join(tmpdir(), 'phone11-win-stage-'));
  const exportRoot = await mkdtemp(join(tmpdir(), 'phone11-win-app-'));
  try {
    const helperDir = join(stage, 'helper', 'win');
    await mkdir(helperDir, { recursive: true });
    await copyFile(helper, join(helperDir, 'phone11_siprix_helper.exe'));
    for (const name of Object.keys(sdkDllHashes)) await copyFile(join(lib, name), join(helperDir, name));
    await writeFile(join(stage, 'config.json'), JSON.stringify({ apiOrigin }, null, 2) + '\n');
    const manifest = Buffer.from(JSON.stringify({ platform: 'win32', files, symlinks: {} }, null, 2) + '\n');
    await writeFile(join(stage, 'helper-integrity.json'), manifest);
    const pin = sha(manifest);
    if (!(await verifyPackagedHelper(helperExecutable(stage, 'win32'), stage, pin, 'win32')))
      throw new Error('Staged Windows helper integrity verification failed');
    assertCommittedDesktopSource(repoRoot);
    execFileSync(process.execPath, [join(appRoot, 'scripts/build.mjs')], {
      cwd: appRoot, env: { ...process.env, PHONE11_RESOURCE_STAGE: stage, PHONE11_BUILD_PLATFORM: 'win32' },
      stdio: 'inherit',
    });
    assertCommittedDesktopSource(repoRoot);
    const archive = execFileSync('git', ['archive', 'HEAD', 'desktop/app'], { cwd: repoRoot, maxBuffer: 20_000_000 });
    execFileSync('/usr/bin/tar', ['-xf', '-', '-C', exportRoot], { input: archive });
    const exportedApp = join(exportRoot, 'desktop', 'app');
    await cp(join(appRoot, 'dist'), join(exportedApp, 'dist'), { recursive: true });
    const [appPath] = await packager({ dir: exportedApp, name: 'Phone11-Desktop-Trial',
      platform: 'win32', arch: 'x64', electronVersion: '44.4.5', out: output,
      asar: true, asarIntegrityDigest: false, overwrite: false,
      ignore: [/^\/src(\/|$)/, /^\/test(\/|$)/, /^\/scripts(\/|$)/, /^\/resources(\/|$)/],
    });
    const resources = join(appPath, 'resources');
    await cp(stage, join(resources, 'phone11'), { recursive: true });
    const packaged = join(resources, 'phone11');
    if (!(await verifyPackagedHelper(helperExecutable(packaged, 'win32'), packaged, pin, 'win32')))
      throw new Error('Packaged Windows helper integrity verification failed');
    if (!(await readFile(join(resources, 'app.asar'))).includes(pin))
      throw new Error('Packaged Windows main does not contain the pinned manifest hash');
    if (!(await lstat(join(appPath, 'Phone11-Desktop-Trial.exe'))).isFile())
      throw new Error('Windows Electron executable is missing');
    process.stdout.write(`${appPath}\n`);
  } finally {
    await rm(stage, { recursive: true, force: true });
    await rm(exportRoot, { recursive: true, force: true });
  }
}

void main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
