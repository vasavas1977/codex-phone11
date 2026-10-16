#!/usr/bin/env node
/** Compile the four real backend entries. No mobile lifecycle or app startup. */
import fs from 'node:fs';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const ENTRIES = Object.freeze([
  ['server/_core/index.ts', 'index'],
  ['scripts/phone11-auth-admin.ts', 'auth-admin'],
  ['scripts/phone11-conference-readiness.ts', 'conference-readiness'],
  ['scripts/phone11-profile-photo-worker.ts', 'profile-photo-worker'],
]);
const sha = raw => crypto.createHash('sha256').update(raw).digest('hex');
function need(value, message) { if (!value) throw new Error(message); }
function regular(root, relative) {
  need(typeof relative === 'string' && !path.isAbsolute(relative) && relative.split('/').every(x => x && x !== '.' && x !== '..'), 'Unsafe build input path');
  const target = path.join(root, relative); let cursor = path.dirname(target);
  while (cursor !== path.dirname(cursor)) { need(fs.lstatSync(cursor).isDirectory(), 'Build input ancestor is not a directory'); cursor = path.dirname(cursor); }
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    need(before.isFile() && before.nlink === 1n && before.size <= 8388608n, 'Invalid build input');
    const raw = fs.readFileSync(fd), after = fs.fstatSync(fd, { bigint: true }), named = fs.lstatSync(target, { bigint: true });
    need(['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs'].every(k => before[k] === after[k] && before[k] === named[k]), 'Build input changed');
    return raw;
  } finally { fs.closeSync(fd); }
}
export function verifyInstallInputs(root) {
  const pins = JSON.parse(regular(root, 'infra/docker/backend/public-input-pins.json'));
  need(pins.schema === 'phone11-backend-build-inputs/v1' && pins.pnpmVersion === '9.12.0' && pins.esbuildVersion === '0.25.12', 'Build pins unsupported');
  const pkg = regular(root, 'package.json'), lock = regular(root, 'pnpm-lock.yaml');
  need(sha(pkg) === pins.packageSha256 && sha(lock) === pins.lockSha256 && JSON.parse(pkg).packageManager === 'pnpm@9.12.0', 'Package or lock changed');
  for (const [file, hash] of Object.entries(pins.patches)) need(sha(regular(root, file)) === hash, 'Patched dependency changed');
  const text = lock.toString();
  for (const [name, integrity] of Object.entries(pins.esbuildPackageIntegrities)) {
    const key = name + '@' + pins.esbuildVersion;
    const start = text.indexOf('\n  ' + key + ':\n') >= 0 ? text.indexOf('\n  ' + key + ':\n') : text.indexOf("\n  '" + key + "':\n");
    need(start >= 0, 'Compiler package missing from lock');
    const block = text.slice(start + 1).split(/\n  (?=\S)/)[0];
    need(block.includes('integrity: ' + integrity), 'Compiler package integrity differs');
  }
  return pins;
}
export function verifyContext(root, buildSha) {
  const raw = regular(root, 'RELEASE-CONTEXT.json'), manifest = JSON.parse(raw);
  need(manifest.schema === 'phone11-backend-release-context/v1' && manifest.releaseReady === true && manifest.sourceDirty === false && manifest.allInputsTracked === true && manifest.allInputsMatchCommit === true && manifest.publicOnly === true, 'Context is not a clean tracked release');
  need(/^[a-f0-9]{40}$/.test(buildSha || '') && manifest.sourceCommit === buildSha, 'Build revision differs from context');
  need(JSON.stringify(manifest.buildEntries) === JSON.stringify(ENTRIES.map(x => x[0])), 'Backend entries differ');
  need(Object.keys(manifest.files).length === manifest.fileCount && manifest.fileCount < 190, 'Context file census differs');
  let total = 0;
  for (const [file, expected] of Object.entries(manifest.files)) {
    const body = regular(root, file); total += body.length;
    need(body.length === expected.bytes && sha(body) === expected.sha256, 'Context source differs');
  }
  need(total === manifest.totalBytes, 'Context size differs');
  return { manifest, contextSha256: sha(raw) };
}
export function buildPlan(root, { platform = process.platform, arch = process.arch, nodeVersion = process.versions.node, targetPlatform, buildSha } = {}) {
  const pins = verifyInstallInputs(root), context = verifyContext(root, buildSha);
  const expectedArch = { x64: 'amd64', arm64: 'arm64' }[arch];
  need(platform === 'linux' && expectedArch && targetPlatform === 'linux/' + expectedArch && nodeVersion === pins.nodeVersion, 'Pinned Linux Node/platform mismatch');
  const require = createRequire(path.join(root, 'package.json'));
  const esbuildPackage = require.resolve('esbuild/package.json');
  need(JSON.parse(fs.readFileSync(esbuildPackage)).version === pins.esbuildVersion, 'Installed compiler version differs');
  const nativeName = '@esbuild/linux-' + (arch === 'x64' ? 'x64' : 'arm64');
  const binary = require.resolve(nativeName + '/bin/esbuild', { paths: [path.dirname(esbuildPackage)] });
  const nativePackage = require.resolve(nativeName + '/package.json', { paths: [path.dirname(esbuildPackage)] });
  need(JSON.parse(fs.readFileSync(nativePackage)).version === pins.esbuildVersion, 'Installed native compiler version differs');
  const header = fs.readFileSync(binary), machine = arch === 'x64' ? 62 : 183;
  need(header.length >= 64 && header.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) && header[4] === 2 && header[5] === 1 && header.readUInt16LE(18) === machine, 'Compiler binary is not the pinned platform ELF');
  const assets = {};
  for (const [name, version, wasm] of [['@jsquash/jpeg', '1.6.0', 'codec/dec/mozjpeg_dec.wasm'], ['@jsquash/webp', '1.5.0', 'codec/dec/webp_dec.wasm']]) {
    const decoder = require.resolve(name + '/decode.js'), wasmPath = path.join(path.dirname(decoder), wasm);
    const packageFile = path.join(path.dirname(decoder), 'package.json');
    need(JSON.parse(fs.readFileSync(packageFile)).version === version, 'Decoder package version differs');
    for (const [key, file] of [[name + '/decode.js', decoder], [name + '/' + wasm, wasmPath]]) {
      const body = fs.readFileSync(file); need(body.length > 0 && body.length <= 8388608, 'Decoder asset missing/oversize');
      if (key.endsWith('.wasm')) need(body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])), 'Decoder WASM header invalid');
      assets[key] = { bytes: body.length, sha256: sha(body) };
    }
  }
  const linkTarget = require.resolve('phone11-siprix'); need(fs.statSync(linkTarget).isFile(), 'Declared linked package target missing');
  return { ...context, pins, binary, compilerSha256: sha(header), assets, targetPlatform, commands: ENTRIES.map(([entry, name]) => [entry, '--platform=node', '--packages=external', '--bundle', '--format=esm', '--log-level=warning', '--outfile=dist/' + name + '.mjs', '--metafile=dist/' + name + '.meta.json']) };
}
export function compileBackend(root, options, spawn = spawnSync) {
  const plan = buildPlan(root, options), env = { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C', HOME: '/nonexistent' };
  const invoke = (args, timeout) => {
    const result = spawn(plan.binary, args, { cwd: root, env, input: '', encoding: 'utf8', timeout, maxBuffer: 262144, windowsHide: true });
    need(!result.error && result.status === 0 && result.stderr === '', 'Backend compiler failed or warned'); return result.stdout;
  };
  need(invoke(['--version'], 5000).trim() === plan.pins.esbuildVersion, 'Native compiler reports another version');
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  const outputs = {};
  for (const args of plan.commands) {
    invoke(args, 60000);
    for (const flag of ['--outfile=', '--metafile=']) {
      const name = args.find(x => x.startsWith(flag)).slice(flag.length), body = regular(root, name);
      need(body.length > 0, 'Backend output missing'); outputs[name] = { bytes: body.length, sha256: sha(body) };
    }
  }
  const value = { schema: 'phone11-backend-build-manifest/v1', sourceCommit: plan.manifest.sourceCommit, sourceContextSha256: plan.contextSha256, nodeVersion: process.versions.node, platform: plan.targetPlatform, nodeImage: plan.pins.nodeImage, pnpmVersion: plan.pins.pnpmVersion, esbuildVersion: plan.pins.esbuildVersion, compilerSha256: plan.compilerSha256, outputs, decoderAssets: plan.assets, fullAuthenticatedEntry: 'dist/index.mjs', applicationStarted: false, runtimeAccepted: false };
  fs.writeFileSync(path.join(root, 'dist/build-manifest.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  return value;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = process.cwd();
    if (process.argv.slice(2).join(' ') === '--verify-install-inputs') { verifyInstallInputs(root); console.log('Verified pinned package/lock/patch/compiler inputs; no lifecycle or build executed.'); }
    else if (process.argv.slice(2).join(' ') === '--compile') { compileBackend(root, { targetPlatform: process.env.TARGETPLATFORM, buildSha: process.env.PHONE11_BUILD_SHA }); console.log('Built the four full backend entries; application not started.'); }
    else throw new Error('Use --verify-install-inputs or --compile');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
