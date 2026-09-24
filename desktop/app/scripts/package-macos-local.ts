/** Local-only ad-hoc signed macOS package. Never uploads or creates a release signature. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { packager } from '@electron/packager';
import { helperExecutable, verifyPackagedHelper } from '../src/helper-verifier';

const appRoot = resolve(__dirname, '..');
const repoRoot = resolve(appRoot, '..', '..');
async function main(): Promise<void> {
  const stage = process.env.PHONE11_RESOURCE_STAGE;
  const output = process.env.PHONE11_PACKAGE_OUTPUT;
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Local package requires macOS arm64');
  if (!stage || !output || !isAbsolute(stage) || !isAbsolute(output))
    throw new Error('Set absolute PHONE11_RESOURCE_STAGE and PHONE11_PACKAGE_OUTPUT');
  const stageReal = await realpath(stage);
  const outputReal = await realpath(output);
  const sourceReal = await realpath(repoRoot);
  if (!(await stat(stageReal)).isDirectory() || !(await stat(outputReal)).isDirectory())
    throw new Error('Resource stage and package output must be existing directories');
  const contains = (parent: string, child: string): boolean =>
    parent === child || child.startsWith(`${parent}${sep}`);
  if (contains(sourceReal, stageReal) || contains(sourceReal, outputReal) ||
      contains(stageReal, outputReal) || contains(outputReal, stageReal))
    throw new Error('Resource stage and package output must be separate directories outside the repository');
  const config = JSON.parse(await readFile(join(stageReal, 'config.json'), 'utf8')) as { apiOrigin?: unknown };
  if (typeof config.apiOrigin !== 'string' || Object.keys(config).length !== 1)
    throw new Error('Config must contain only the HTTPS API origin');
  const origin = new URL(config.apiOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' ||
      origin.search || origin.hash) throw new Error('Invalid HTTPS API origin');
  const manifest = await readFile(join(stageReal, 'helper-integrity.json'));
  const pin = createHash('sha256').update(manifest).digest('hex');
  if (!(await verifyPackagedHelper(helperExecutable(stageReal, 'darwin'), stageReal, pin, 'darwin')))
    throw new Error('Staged helper integrity verification failed');
  execFileSync(process.execPath, [join(appRoot, 'scripts/build.mjs')], {
    cwd: appRoot, env: { ...process.env, PHONE11_RESOURCE_STAGE: stageReal }, stdio: 'inherit',
  });
  // Package committed app metadata/source, adding only the newly built dist.
  execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'desktop/app/src', 'desktop/app/scripts/build.mjs'],
    { cwd: repoRoot });
  const exportRoot = await mkdtemp(join(tmpdir(), 'phone11-committed-app-'));
  let appPath: string;
  try {
    const archive = execFileSync('git', ['archive', 'HEAD', 'desktop/app'], { cwd: repoRoot, maxBuffer: 20_000_000 });
    execFileSync('/usr/bin/tar', ['-xf', '-', '-C', exportRoot], { input: archive });
    const exportedApp = join(exportRoot, 'desktop', 'app');
    execFileSync('/usr/bin/ditto', [join(appRoot, 'dist'), join(exportedApp, 'dist')]);
    [appPath] = await packager({ dir: exportedApp, name: 'Phone11-Desktop-Trial', platform: 'darwin',
      arch: 'arm64', electronVersion: '44.4.5', out: outputReal, asar: true,
      asarIntegrityDigest: false, overwrite: false, appBundleId: 'ai.phone11.desktop.trial',
      ignore: [/^\/src(\/|$)/, /^\/test(\/|$)/, /^\/scripts(\/|$)/, /^\/resources(\/|$)/],
    });
  } finally { await rm(exportRoot, { recursive: true, force: true }); }
  const appBundle = join(appPath, 'Phone11-Desktop-Trial.app');
  const packagedResources = join(appBundle, 'Contents', 'Resources');
  // Packager's extraResource copy rewrites framework symlinks to absolute staging
  // paths. macOS ditto preserves the relative links inside the bundled frameworks.
  const packaged = join(packagedResources, 'phone11');
  await mkdir(packaged);
  await copyFile(join(stageReal, 'config.json'), join(packaged, 'config.json'));
  await copyFile(join(stageReal, 'helper-integrity.json'), join(packaged, 'helper-integrity.json'));
  // Only the three required resources enter the app; unrelated files in the
  // external staging directory must not be bundled.
  execFileSync('/usr/bin/ditto', [join(stageReal, 'helper'), join(packaged, 'helper')],
    { stdio: 'inherit' });
  if (!(await verifyPackagedHelper(helperExecutable(packaged, 'darwin'), packaged, pin, 'darwin')))
    throw new Error('Packaged helper integrity verification failed');
  if (!(await readFile(join(packagedResources, 'app.asar'))).includes(pin))
    throw new Error('Packaged main does not contain the pinned manifest hash');
  // Packager leaves renamed Electron helper apps/frameworks with stale ad-hoc
  // signatures. Seal those first, then seal the outer bundle after resources
  // have been copied. Do not re-sign the manifest-covered Siprix helper.
  const frameworks = join(appBundle, 'Contents', 'Frameworks');
  for (const name of (await readdir(frameworks)).sort()) {
    if (!name.endsWith('.framework') && !name.endsWith('.app')) continue;
    execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none',
      join(frameworks, name)], { stdio: 'inherit' });
  }
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', appBundle],
    { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appBundle],
    { stdio: 'inherit' });
  if (!(await verifyPackagedHelper(helperExecutable(packaged, 'darwin'), packaged, pin, 'darwin')))
    throw new Error('Siprix helper integrity changed during ad-hoc signing');
  process.stdout.write(`${appBundle}\n`);
}
void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
