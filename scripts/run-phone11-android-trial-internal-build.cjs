// Fixed internal-trial EAS invocation. Credentials stay inside the protected CLI.
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { readFileSync, realpathSync } = require('node:fs');
const { isAbsolute, join, resolve } = require('node:path');

const PROFILE = 'preview-android-siprix-foreground-trial';
const REPOSITORY = 'vasavas1977/codex-phone11';
const REF = 'refs/heads/codex/phone11-zoom-mainline-integration-20260928';
const PROJECT = 'e354ffd3-485c-49f1-9e6f-aebe571d8dfb';
const cliFiles = {
  'build/credentials/android/AndroidCredentialsProvider.js': '599cc9c1f3c121dd1c96f2c46ea7986607f58ca49aee78409634dbd709adb2f7',
  'build/credentials/android/actions/SetUpBuildCredentials.js': 'f27b3c502586164cad44b7fb1faa7aa25c6cd03ed1e039a89de07348c34479ec',
  'build/credentials/android/actions/CreateKeystore.js': 'a2b725e8d9769a4abb2e9fe39f03da8fd9c1299d7c81199008b52e6d73430e75',
};
const fail = () => { throw new Error('E_ANDROID_EXISTING_CREDENTIALS_REQUIRED'); };

function requireManagedInvocation(env, actualHead) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
      || env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_REF !== REF
      || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') || actualHead !== env.GITHUB_SHA
      || env.NODE_OPTIONS || env.EAS_BUILD_PROFILE || env.PHONE11_SIPRIX_LICENSE) {
    throw new Error('E_ANDROID_TRIAL_INVOCATION');
  }
}

function freezeAndroidProvider(Provider, Setup, Create) {
  if (typeof Provider?.prototype?.getRemoteAsync !== 'function'
      || typeof Provider.prototype.getLocalAsync !== 'function'
      || typeof Setup?.prototype?.getFullySetupBuildCredentialsAsync !== 'function'
      || typeof Create?.prototype?.runAsync !== 'function'
      || typeof Create.prototype.provideOrGenerateAsync !== 'function') {
    throw new Error('E_ANDROID_TRIAL_CLI_CONTRACT');
  }
  // EAS 23.2.0's Android setup does not enforce --freeze-credentials. Skip its
  // mutation branch entirely; missing or concurrently removed credentials refuse.
  Provider.prototype.getRemoteAsync = async function () {
    const setup = new Setup(this.options);
    const existing = await setup.getFullySetupBuildCredentialsAsync({
      ctx: this.ctx, app: this.options.app, name: this.options.name,
    });
    if (!existing?.androidKeystore) fail();
    return this.toAndroidCredentials(existing);
  };
  Provider.prototype.getLocalAsync = fail;
  Create.prototype.runAsync = fail;
  Create.prototype.provideOrGenerateAsync = fail;
}

function installGuard(cliRoot) {
  const root = realpathSync(cliRoot);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (pkg.name !== 'eas-cli' || pkg.version !== '23.2.0' || pkg.bin?.eas !== './bin/run') {
    throw new Error('E_ANDROID_TRIAL_CLI_VERSION');
  }
  for (const [file, expected] of Object.entries(cliFiles)) {
    const actual = createHash('sha256').update(readFileSync(join(root, file))).digest('hex');
    if (actual !== expected) throw new Error('E_ANDROID_TRIAL_CLI_BYTES');
  }
  freezeAndroidProvider(
    require(join(root, 'build/credentials/android/AndroidCredentialsProvider.js')).default,
    require(join(root, 'build/credentials/android/actions/SetUpBuildCredentials.js')).SetUpBuildCredentials,
    require(join(root, 'build/credentials/android/actions/CreateKeystore.js')).CreateKeystore,
  );
  return { root, version: pkg.version };
}

function main() {
  if (process.argv.length === 4 && process.argv[2] === '--check-guard') {
    const installed = installGuard(resolve(process.argv[3]));
    console.log(JSON.stringify({ version: installed.version, inspectedFiles: 3,
      credentialMutationBlocked: true, buildRequested: false }));
    return;
  }
  if (process.argv.length !== 2) throw new Error('E_ANDROID_TRIAL_ARGUMENTS');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  requireManagedInvocation(process.env, head);
  execFileSync('git', ['diff', '--quiet'], { stdio: 'ignore' });
  execFileSync('git', ['diff', '--cached', '--quiet'], { stdio: 'ignore' });
  const config = JSON.parse(readFileSync('eas.json', 'utf8')).build[PROFILE];
  if (config.distribution !== 'internal' || config.developmentClient !== false
      || config.environment !== 'preview' || config.android?.buildType !== 'apk'
      || config.extends || config.android.gradleCommand || config.env?.PHONE11_SIPRIX_LICENSE) {
    throw new Error('E_ANDROID_TRIAL_PROFILE');
  }
  const appConfig = readFileSync('app.config.ts', 'utf8');
  if (!appConfig.includes(`projectId: "${PROJECT}"`)) throw new Error('E_ANDROID_TRIAL_PROJECT');
  // pnpm's executable can be a shell shim. Load the pinned package itself.
  const globalRoot = execFileSync('pnpm', ['root', '--global'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  if (!isAbsolute(globalRoot)) throw new Error('E_ANDROID_TRIAL_CLI_LOCATION');
  const installed = installGuard(join(globalRoot, 'eas-cli'));
  process.argv = [process.execPath, join(installed.root, 'bin/run'), 'build', '--platform', 'android',
    '--profile', PROFILE, '--non-interactive', '--freeze-credentials', '--wait', '--json'];
  require(join(installed.root, 'bin/run'));
}

module.exports = { PROFILE, requireManagedInvocation, freezeAndroidProvider, installGuard };
if (require.main === module) {
  try { main(); }
  catch { console.error('Phone11 Android internal build refused; check managed invocation, exact CLI and existing credentials.'); process.exitCode = 1; }
}
