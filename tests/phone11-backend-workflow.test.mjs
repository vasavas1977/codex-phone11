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
