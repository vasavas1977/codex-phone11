import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ENTRIES, verifyInstallInputs, verifyContext, buildPlan, compileBackend } from '../scripts/build-phone11-backend.mjs';
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const realPins = JSON.parse(fs.readFileSync(path.join(REPO, 'infra/docker/backend/public-input-pins.json')));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(REPO, 'tests/.backend-build-fixture-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (file, raw) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), raw); };
  const pkg = JSON.stringify({ name: 'owned-public-fixture', packageManager: 'pnpm@9.12.0' });
  const lock = 'packages:\n' + Object.entries(realPins.esbuildPackageIntegrities).map(([name, integrity]) => `  '${name}@0.25.12':\n    resolution: {integrity: ${integrity}}\n`).join('');
  const pins = { ...realPins, packageSha256: hash(pkg), lockSha256: hash(lock), patches: {} };
  put('package.json', pkg); put('pnpm-lock.yaml', lock); put('infra/docker/backend/public-input-pins.json', JSON.stringify(pins));
  for (const [entry] of ENTRIES) put(entry, '// owned public fixture; never evaluated\n');
  put('node_modules/esbuild/package.json', JSON.stringify({ name: 'esbuild', version: '0.25.12' }));
  for (const [arch, machine] of [['x64', 62], ['arm64', 183]]) { const b = Buffer.alloc(64); b.set([127, 69, 76, 70, 2, 1]); b.writeUInt16LE(machine, 18); put(`node_modules/@esbuild/linux-${arch}/package.json`, JSON.stringify({ name: `@esbuild/linux-${arch}`, version: '0.25.12' })); put(`node_modules/@esbuild/linux-${arch}/bin/esbuild`, b); }
  for (const [name, version, wasm] of [['jpeg', '1.6.0', 'mozjpeg_dec.wasm'], ['webp', '1.5.0', 'webp_dec.wasm']]) { put(`node_modules/@jsquash/${name}/package.json`, JSON.stringify({ name: '@jsquash/' + name, version })); put(`node_modules/@jsquash/${name}/decode.js`, '// owned decoder fixture, not executed'); put(`node_modules/@jsquash/${name}/codec/dec/${wasm}`, Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])); }
  put('node_modules/phone11-siprix/package.json', '{"main":"index.js"}'); put('node_modules/phone11-siprix/index.js', '// link target fixture, never evaluated');
  const inputs = ['package.json', 'pnpm-lock.yaml', 'infra/docker/backend/public-input-pins.json', ...ENTRIES.map(x => x[0])];
  const files = Object.fromEntries(inputs.map(file => { const raw = fs.readFileSync(path.join(root, file)); return [file, { bytes: raw.length, sha256: hash(raw) }]; }));
  const manifest = { schema: 'phone11-backend-release-context/v1', sourceCommit: 'a'.repeat(40), releaseReady: true, sourceDirty: false, allInputsTracked: true, allInputsMatchCommit: true, publicOnly: true, files, fileCount: inputs.length, totalBytes: Object.values(files).reduce((n, x) => n + x.bytes, 0), buildEntries: ENTRIES.map(x => x[0]) };
  put('RELEASE-CONTEXT.json', JSON.stringify(manifest));
  const options = { platform: 'linux', arch: 'x64', nodeVersion: '22.23.3', targetPlatform: 'linux/amd64', buildSha: 'a'.repeat(40) };
  return { root, put, manifest, options };
}
test('lock/package/compiler-integrity tampering refuses before native execution', t => {
  const f = fixture(t); assert.equal(verifyInstallInputs(f.root).pnpmVersion, '9.12.0'); f.put('pnpm-lock.yaml', 'OWNED_MODIFIED'); assert.throws(() => verifyInstallInputs(f.root), /Package or lock changed/);
});
test('dirty, untracked, wrong-revision and changed context refuse', t => {
  for (const mode of ['dirty', 'untracked', 'blob', 'revision', 'bytes']) { const f = fixture(t); if (mode === 'dirty') f.manifest.sourceDirty = true; if (mode === 'untracked') f.manifest.allInputsTracked = false; if (mode === 'blob') f.manifest.allInputsMatchCommit = false; if (mode === 'revision') f.manifest.sourceCommit = 'b'.repeat(40); if (mode === 'bytes') f.put('server/_core/index.ts', 'OWNED_CHANGED'); else f.put('RELEASE-CONTEXT.json', JSON.stringify(f.manifest)); assert.throws(() => verifyContext(f.root, f.options.buildSha)); }
});
test('both pinned native platforms plan four real externalized ESM entries', t => {
  const f = fixture(t); for (const [arch, target] of [['x64', 'linux/amd64'], ['arm64', 'linux/arm64']]) { const p = buildPlan(f.root, { ...f.options, arch, targetPlatform: target }); assert.equal(p.commands.length, 4); assert.deepEqual(p.commands.map(x => x[0]), ENTRIES.map(x => x[0])); assert.ok(p.commands.every(x => x.includes('--packages=external') && x.includes('--format=esm'))); assert.equal(Object.keys(p.assets).length, 4); }
});
test('missing or invalid WASM and broken linked package stop before any compiler child', t => {
  for (const mode of ['missing', 'invalid', 'link']) { const f = fixture(t), wasm = 'node_modules/@jsquash/webp/codec/dec/webp_dec.wasm'; if (mode === 'missing') fs.unlinkSync(path.join(f.root, wasm)); if (mode === 'invalid') f.put(wasm, 'WRONG_WASM'); if (mode === 'link') fs.unlinkSync(path.join(f.root, 'node_modules/phone11-siprix/index.js')); let calls = 0; assert.throws(() => compileBackend(f.root, f.options, () => { calls++; }), /ENOENT|Decoder WASM header invalid|Cannot find module/); assert.equal(calls, 0); }
});
test('wrong platform, Node version or ELF machine refuses before compiler child', t => {
  for (const mode of ['platform', 'version', 'ELF']) { const f = fixture(t); let options = f.options; if (mode === 'platform') options = { ...options, targetPlatform: 'linux/arm64' }; if (mode === 'version') options = { ...options, nodeVersion: '22.23.2' }; if (mode === 'ELF') f.put('node_modules/@esbuild/linux-x64/bin/esbuild', Buffer.alloc(64)); let calls = 0; assert.throws(() => compileBackend(f.root, options, () => { calls++; }), /Pinned Linux Node\/platform mismatch|Compiler binary is not the pinned platform ELF/); assert.equal(calls, 0); }
});
test('compiler stderr, timeout and wrong reported version cannot become successful build', t => {
  for (const mode of ['stderr', 'timeout', 'version']) { const f = fixture(t); let calls = 0; const spawn = () => { calls++; return { status: 0, stdout: mode === 'version' ? '0.25.11\n' : '0.25.12\n', stderr: mode === 'stderr' ? 'OWNED_WARNING' : '', error: mode === 'timeout' ? new Error('OWNED_TIMEOUT') : undefined }; }; assert.throws(() => compileBackend(f.root, f.options, spawn)); assert.equal(calls, 1); assert.ok(!fs.existsSync(path.join(f.root, 'dist/build-manifest.json'))); }
});
test('genuine compile control flow records four outputs only with owned substituted compiler', t => {
  const f = fixture(t), calls = []; const spawn = (binary, args, options) => { calls.push({ binary, args, options }); assert.ok(binary.startsWith(f.root + '/node_modules/@esbuild/linux-x64/')); assert.deepEqual(options.env, { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C', HOME: '/nonexistent' }); if (args[0] === '--version') return { status: 0, stdout: '0.25.12\n', stderr: '' }; for (const prefix of ['--outfile=', '--metafile=']) f.put(args.find(x => x.startsWith(prefix)).slice(prefix.length), 'OWNED_SUBSTITUTED_COMPILER_OUTPUT'); return { status: 0, stdout: '', stderr: '' }; }; const result = compileBackend(f.root, f.options, spawn); assert.equal(calls.length, 5); assert.equal(Object.keys(result.outputs).length, 8); assert.equal(result.applicationStarted, false); assert.equal(result.runtimeAccepted, false); assert.ok(calls.slice(1).every(x => x.options.timeout === 60000));
});
test('ordinary Docker and existing manual build workflow use safe context and no install hooks', () => {
  const docker = fs.readFileSync(path.join(REPO, 'infra/docker/backend/Dockerfile'), 'utf8'), workflow = fs.readFileSync(path.join(REPO, '.github/workflows/docker-build.yml'), 'utf8');
  assert.equal(docker.split('\n').filter(x => x.startsWith('FROM ')).length, 3); assert.ok(docker.split('\n').filter(x => x.startsWith('FROM ')).every(x => x.endsWith(' AS production') || x.includes(' AS '))); assert.ok(docker.split('\n').filter(x => x.startsWith('FROM ')).every(x => x.includes(realPins.nodeImage))); assert.ok(docker.split('\n').filter(x => x.includes('pnpm install')).every(x => x.includes('--frozen-lockfile') && x.includes('--ignore-scripts'))); assert.ok(docker.includes('RUN --network=none node scripts/build-phone11-backend.mjs --compile')); assert.ok(docker.includes('COPY --from=production-dependencies /app/modules/phone11-siprix'));
  assert.ok(workflow.includes('workflow_dispatch:')); assert.ok(!/^  (push|pull_request):/m.test(workflow)); assert.ok(workflow.includes('prepare-phone11-backend-context.py --prepare')); assert.ok(workflow.includes('PHONE11_BUILD_SHA=${{ github.sha }}')); assert.ok(!workflow.includes('          context: .\n')); assert.ok(workflow.includes('          push: true')); assert.ok(workflow.includes('          platforms: ${{ inputs.platform }}'));
});
