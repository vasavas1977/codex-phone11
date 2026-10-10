import { execFileSync } from 'node:child_process';

/** Dist is built from the worktree, so every source input must match HEAD. */
export function assertCommittedDesktopSource(repoRoot: string): void {
  try {
    execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'desktop/app', 'desktop/src'], { cwd: repoRoot });
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--',
      'desktop/app', 'desktop/src'], { cwd: repoRoot, encoding: 'utf8' });
    // Also catch ignored source files: Git ignore rules must not weaken the build gate.
    const ignoredSource = execFileSync('git', ['ls-files', '--others', '--',
      'desktop/app/src', 'desktop/app/scripts', 'desktop/src',
      'desktop/app/package.json', 'desktop/app/package-lock.json'], { cwd: repoRoot, encoding: 'utf8' });
    if (untracked || ignoredSource) throw new Error('Uncommitted desktop source');
  } catch {
    throw new Error('Desktop package requires committed, unchanged source');
  }
}
