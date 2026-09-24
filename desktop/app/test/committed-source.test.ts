import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertCommittedDesktopSource } from '../scripts/committed-source';

test('package gate rejects untracked and ignored meeting preload source', () => {
  const root = mkdtempSync(join(tmpdir(), 'phone11-source-gate-'));
  try {
    mkdirSync(join(root, 'desktop/app/src'), { recursive: true });
    writeFileSync(join(root, 'desktop/app/src/main.ts'), 'export {}\n');
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', 'desktop/app/src/main.ts'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test',
      'commit', '-q', '-m', 'fixture'], { cwd: root });
    assert.doesNotThrow(() => assertCommittedDesktopSource(root));
    writeFileSync(join(root, 'desktop/app/src/meeting-preload.ts'), 'export {}\n');
    assert.throws(() => assertCommittedDesktopSource(root), /committed, unchanged source/);
    rmSync(join(root, 'desktop/app/src/meeting-preload.ts'));
    writeFileSync(join(root, '.gitignore'), 'desktop/app/src/meeting-preload.ts\n');
    writeFileSync(join(root, 'desktop/app/src/meeting-preload.ts'), 'export {}\n');
    assert.throws(() => assertCommittedDesktopSource(root), /committed, unchanged source/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
