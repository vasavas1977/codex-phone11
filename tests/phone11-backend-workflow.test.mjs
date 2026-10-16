import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/docker-build.yml'), 'utf8');
const steps = workflow.split(/^      - name: /m).slice(1).map(raw => ({ name: raw.split('\n')[0], raw }));
const step = name => { const value = steps.find(s => s.name === name); assert.ok(value, name); return value.raw; };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(ROOT, 'tests/.backend-workflow-fixture-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('manual publish default preserves ECR flow; build-only excludes every AWS step', () => {
  assert.match(workflow, /publish:\n[\s\S]*?type: boolean\n        default: true/);
  assert.deepEqual([...workflow.matchAll(/^  ([a-z_]+):$/gm)].map(x => x[1]).filter(x => ['workflow_dispatch', 'push', 'pull_request', 'schedule'].includes(x)), ['workflow_dispatch']);
  const aws = ['Validate AWS region', 'Configure AWS credentials', 'Login to ECR', 'Require the existing backend repository'];
  for (const name of aws) assert.match(step(name), /\n        if: inputs\.publish\n/);
  const publish = step('Build and push Backend'), local = step('Build Backend locally without publishing');
  assert.match(publish, /if: inputs\.publish/); assert.match(publish, /push: true/);
  assert.match(publish, /\$\{\{ steps\.ecr\.outputs\.registry \}\}\/cloudphone11\/backend:\$\{\{ github\.sha \}\}/);
  assert.match(local, /if: \$\{\{ !inputs\.publish \}\}/); assert.match(local, /push: false\n          load: true/);
  assert.match(local, /tags: phone11-backend-check:\$\{\{ github\.sha \}\}/); assert.ok(!local.includes('ecr.outputs'));
  assert.ok(!local.includes('cache-to:')); // Local load needs no remote/cache-export driver setup.
  for (const name of ['Record finite local image metadata', 'Keep local build metadata']) assert.match(step(name), /if: \$\{\{ !inputs\.publish \}\}/);
  for (const build of [publish, local]) {
    assert.match(build, /context: \$\{\{ runner\.temp \}\}\/phone11-backend-context/);
    assert.match(build, /platforms: \$\{\{ inputs\.platform \}\}/);
    assert.match(build, /PHONE11_BUILD_SHA=\$\{\{ github\.sha \}\}/);
  }
  assert.ok(workflow.indexOf('Require the existing backend repository') < workflow.indexOf('Build and push Backend'));
  assert.ok(!/create-repository|create-role|docker run|docker push/.test(workflow));
  assert.match(workflow, /permissions:\n  id-token: write\n  contents: read\n/);
});

test('exact repository guard rejects missing/wrong repository before build', t => {
  const dir = fixture(t), script = step('Require the existing backend repository').split('        run: |\n')[1].split('\n').filter(x => x.startsWith('          ')).map(x => x.slice(10)).join('\n');
  for (const [body, expected] of [['printf "%s\\n" cloudphone11/backend', 0], ['exit 254', 1], ['printf "%s\\n" another/repository', 1]]) {
    fs.writeFileSync(path.join(dir, 'aws'), '#!/bin/sh\n' + body + '\n', { mode: 0o700 });
    const result = spawnSync('/bin/bash', ['-c', script], { env: { PATH: dir + ':/usr/bin:/bin', AWS_REGION: 'owned-fixture-region' }, encoding: 'utf8', timeout: 10000 });
    assert.ok(!result.error, result.error?.message); assert.equal(result.status === 0 ? 0 : 1, expected, result.stderr);
  }
  assert.match(script, /--repository-names cloudphone11\/backend/);
  assert.match(script, /set -euo pipefail/);
});

test('finite loaded-image metadata validates revision/platform/identity without printing raw data', t => {
  const dir = fixture(t), commit = 'a'.repeat(40), output = path.join(dir, 'metadata.json');
  const invoke = sha => spawnSync('python3', ['-I', '-B', path.join(ROOT, 'scripts/describe-phone11-backend-image.py'), '--commit', sha, '--output', output], { env: { PATH: dir + ':' + process.env.PATH }, encoding: 'utf8', timeout: 10000 });
  const valid = { imageId: 'sha256:' + 'b'.repeat(64), os: 'linux', architecture: 'amd64', revision: commit };
  const fakeDocker = body => '#!/bin/sh\n[ "$1" = image ] && [ "$2" = inspect ] && [ "$3" = --format ] && [ "$5" = phone11-backend-check:' + commit + ' ] || exit 99\n' + body + '\n';
  for (const change of [{ revision: 'c'.repeat(40) }, { architecture: 'arm64' }, { imageId: 'NOT_AN_IMAGE' }, { privateField: 'OWNED_PRIVATE_SENTINEL' }]) {
    fs.writeFileSync(path.join(dir, 'docker'), fakeDocker('printf \'%s\\n\' \'' + JSON.stringify({ ...valid, ...change }) + '\''), { mode: 0o700 });
    const result = invoke(commit); assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.ok(!result.stderr.includes('OWNED_PRIVATE_SENTINEL')); assert.ok(!fs.existsSync(output));
  }
  fs.writeFileSync(path.join(dir, 'docker'), fakeDocker('printf \'%s\\n\' \'' + JSON.stringify(valid) + '\''), { mode: 0o700 });
  assert.equal(invoke('invalid').status, 1); assert.ok(!fs.existsSync(output));
  const result = invoke(commit); assert.equal(result.status, 0); assert.equal(result.stderr, '');
  const value = JSON.parse(fs.readFileSync(output)); assert.deepEqual(value, { sourceCommit: commit, platform: 'linux/amd64', imageId: valid.imageId, localTag: 'phone11-backend-check:' + commit, published: false, applicationStarted: false });
  assert.equal(invoke(commit).status, 1); assert.deepEqual(JSON.parse(fs.readFileSync(output)), value);
});

function condition(name, inputs, outcomes = {}, successful = true) {
  const raw = step(name).match(/^        if: (.+)$/m)?.[1];
  assert.ok(raw, name);
  const expression = raw.replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '');
  return Boolean(Function('inputs', 'steps', 'success', `return (${expression});`)(
    inputs, { smoke: { outcome: outcomes.smoke }, package: { outcome: outcomes.package } }, () => successful,
  ));
}

test('optional archive gates refuse publish before AWS and require same-job successful smoke and package', () => {
  assert.match(workflow, /package_image:\n        description: [^\n]+\n        required: true\n        type: boolean\n        default: false/);
  const refusal = 'Refuse publishing when packaging the image';
  const packageStep = 'Package the successfully smoked public CI image', upload = 'Keep the completed public CI image package';
  assert.ok(workflow.indexOf(refusal) < workflow.indexOf('Validate AWS region'));
  assert.match(step(refusal), /run: echo 'package_image requires publish=false' >&2; exit 1/);
  assert.match(step('Smoke the isolated backend process'), /\n        id: smoke\n/);
  assert.match(step(packageStep), /\n        id: package\n/);
  const rows = [
    // package requested, publish, prior job successful, smoke outcome, package outcome, package gate, upload gate
    [false, false, true, 'success', 'success', false, false],
    [false, true, true, 'skipped', 'skipped', false, false],
    [true, true, true, 'success', 'success', false, false],
    [true, false, true, 'success', 'success', true, true],
    [true, false, true, 'skipped', 'success', false, false],
    [true, false, true, 'failure', 'success', false, false],
    [true, false, true, 'cancelled', 'success', false, false],
    [true, false, false, 'success', 'success', false, false],
    [true, false, true, 'success', 'failure', true, false],
    [true, false, true, 'success', 'cancelled', true, false],
    [true, false, true, 'success', 'skipped', true, false],
  ];
  for (const [package_image, publish, successful, smoke, archive, canPackage, canUpload] of rows) {
    const inputs = { package_image, publish }, outcomes = { smoke, package: archive };
    assert.equal(condition(refusal, inputs, outcomes), package_image && publish);
    assert.equal(condition(packageStep, inputs, outcomes, successful), canPackage);
    assert.equal(condition(upload, inputs, outcomes, successful), canUpload);
  }
});

test('archive command binds same-job receipts and propagates helper failure without adopting output', t => {
  const dir = fixture(t), runnerTemp = path.join(dir, 'runner temp'), argumentsFile = path.join(dir, 'arguments');
  fs.mkdirSync(runnerTemp);
  const script = step('Package the successfully smoked public CI image').match(/^        run: (.+)$/m)?.[1];
  assert.ok(script); assert.match(step('Package the successfully smoked public CI image'), /timeout-minutes: 6/);
  fs.writeFileSync(path.join(dir, 'python3'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$ARGUMENTS"\nmkdir "$RUNNER_TEMP/phone11-backend-package" || exit 98\nprintf PUBLIC_SYNTHETIC_NOT_AN_IMAGE > "$RUNNER_TEMP/phone11-backend-package/backend-image.tar"\nprintf SYNTHETIC_COMPLETE_LOOKING > "$RUNNER_TEMP/phone11-backend-package/manifest.json"\nexit "$FAKE_EXIT"\n', { mode: 0o700 });
  const commit = 'a'.repeat(40);
  for (const status of [0, 37]) {
    const result = spawnSync('/bin/bash', ['-e', '-o', 'pipefail', '-c', script], { env: { PATH: dir + ':/usr/bin:/bin', GITHUB_SHA: commit, RUNNER_TEMP: runnerTemp, ARGUMENTS: argumentsFile, FAKE_EXIT: String(status) }, encoding: 'utf8', timeout: 10000 });
    assert.ok(!result.error, result.error?.message); assert.equal(result.status, status); assert.equal(result.stderr, '');
    assert.deepEqual(fs.readFileSync(argumentsFile, 'utf8').trimEnd().split('\n'), ['-I', '-B', 'scripts/package-phone11-backend-image.py', '--commit', commit, '--metadata', path.join(runnerTemp, 'phone11-backend-build.json'), '--smoke', path.join(runnerTemp, 'phone11-backend-smoke.json'), '--output', path.join(runnerTemp, 'phone11-backend-package')]);
    assert.deepEqual(fs.readdirSync(path.join(runnerTemp, 'phone11-backend-package')).sort(), ['backend-image.tar', 'manifest.json']);
    assert.equal(condition('Keep the completed public CI image package', { package_image: true, publish: false }, { smoke: 'success', package: status === 0 ? 'success' : 'failure' }, status === 0), status === 0);
    fs.rmSync(path.join(runnerTemp, 'phone11-backend-package'), { recursive: true });
  }
  assert.ok(!/\|\||continue-on-error|always\(\)|mkdir|rm |tar |docker /.test(step('Package the successfully smoked public CI image')));
});

test('archive upload is success-only and selects exactly two public package leaves for one day', () => {
  const block = step('Keep the completed public CI image package');
  assert.match(block, /uses: actions\/upload-artifact@v4/);
  const paths = block.split('          path: |\n')[1].split('\n').filter(line => line.startsWith('            ')).map(line => line.trim());
  assert.deepEqual(paths, ['${{ runner.temp }}/phone11-backend-package/backend-image.tar', '${{ runner.temp }}/phone11-backend-package/manifest.json']);
  assert.match(block, /if-no-files-found: error\n          retention-days: 1\n          compression-level: 0/);
  assert.ok(!/always\(\)|continue-on-error|\*|private|smoke\.json|\.log/.test(block));
  assert.ok(workflow.indexOf('Smoke the isolated backend process') < workflow.indexOf('Package the successfully smoked public CI image'));
  assert.ok(workflow.indexOf('Package the successfully smoked public CI image') < workflow.indexOf('Keep the completed public CI image package'));
});
