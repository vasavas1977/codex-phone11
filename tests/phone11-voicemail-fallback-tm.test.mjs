import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = 'tests/fixtures/phone11-voicemail-fallback-tm/';
const config = readFileSync(root + fixture + 'runtime.cfg', 'utf8');

test('TM runtime fixture is loopback-only and absent from deployed routing', () => {
  assert.match(config, /listen=udp:127\.0\.0\.1:15060/);
  for (const uri of config.matchAll(/https?:\/\/[^"\s]+|sip:[^"\s]+/g)) {
    assert.match(uri[0], /127\.0\.0\.1/, `non-loopback fixture URI: ${uri[0]}`);
  }
  for (const path of ['infra/configs/kamailio/kamailio.cfg', 'deploy/kamailio/kamailio.cfg']) {
    assert.doesNotMatch(readFileSync(root + path, 'utf8'), /phone11-voicemail-fallback-tm/);
  }
  execFileSync('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', root + fixture + 'run.py']);
});

test('Kamailio TM final-failure runtime matrix', { skip: !process.env.PHONE11_VM_TM_IMAGE }, () => {
  const output = execFileSync('docker', [
    'run', '--rm', '--network', 'none', '--platform', 'linux/amd64',
    '-v', `${root}:/work:ro`, process.env.PHONE11_VM_TM_IMAGE,
    'python3', '/work/' + fixture + 'run.py',
  ], { encoding: 'utf8', timeout: 60000 });
  assert.match(output, /"kamailio_parser": "pass"/);
  assert.equal((output.match(/"result": "pass"/g) ?? []).length, 6, output);
});
