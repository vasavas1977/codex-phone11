// Protected child only: provider output is captured by the fixed parent runner.
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { readFileSync, realpathSync, writeSync } = require('node:fs');
const { join, resolve, relative, isAbsolute, sep } = require('node:path');

const PROFILE = 'preview-ios-siprix-daily-pilot';
const PROJECT = 'e354ffd3-485c-49f1-9e6f-aebe571d8dfb';
const BUNDLE = 'space.manus.phone11ai.t20260425073427';
const REPOSITORY = 'vasavas1977/codex-phone11';
const REF = 'refs/heads/codex/phone11-zoom-mainline-integration-20260928';
const CLI_FILES = Object.freeze({
  'bin/run': '96fd6dee1960fdc9b41d154cf1e3d31ecb8f8f16d1dd9f8fb5df62e997ca123a',
  'build/credentials/ios/IosCredentialsProvider.js': '252d77ef9cee4f1270af8a9cc977268eb041c21265f46ed6ba0eb11ded669abb',
  'build/credentials/ios/actions/BuildCredentialsUtils.js': '603246c92e5cf758caeb8da97b7b1775e90d5f45ac4c07b299ac554cdf3e234a',
  'build/credentials/ios/api/GraphqlClient.js': 'a5e68aced8273bf542e2c71f78a2ee3e8a796527ba1a9d909aaa14b31d6b2963',
  'build/credentials/ios/api/graphql/queries/AppleAppIdentifierQuery.js': '6d5a0cb49feafac348cfce7c9bff40afed34912ee91ce8b59f93ec9b19b387c9',
  'build/credentials/ios/api/graphql/queries/IosAppCredentialsQuery.js': '0a4043014417745268142bde18aea49dc43e8db671cb4d4d60c66a4dc02e96f9',
  'build/credentials/ios/validators/validateProvisioningProfile.js': 'c79c84bfc36bfdc08519f8f9b80a76d4493278a2b8a28e0575e9cc0ce75b8c78',
  'build/credentials/ios/utils/provisioningProfile.js': '4c84db462903e64e96dd6d09826760d1fc285e921938ac9f949be89eede0fa90',
  'build/credentials/ios/utils/p12Certificate.js': '188d4f4fc780885ce001dac7df3e9d913df0ffe201f57e5c87d75c93803a22b1',
  'build/credentials/context.js': '1a2b40cfeeadfd118c912e969675492cd1521dd9f57e5d4b5271d9dce2734060',
  'build/credentials/ios/appstore/AppStoreApi.js': '2438b453f108cd4f8bb3c03655b783604bb1df9278ca05da4e446e6d8aa9e736',
  'build/credentials/ios/actions/SetUpBuildCredentials.js': '356e642115f552bbde87e53864b7cbd0ac3d5f7d74f627a0c14c6b6a7acba18d',
  'build/commands/build/index.js': 'dd1b2432dcf8974caf659305cbb0e7ac45b178e8eb868ca73237afccbc26df0a',
  'build/graphql/generated.js': 'f437bf8ce9c14be043e7c75cecf224a1a33cf0d7925c274696c743400e8bb94d',
});
const FAILURE_CODES = Object.freeze(['INVOCATION_REFUSED', 'CONFIG_REFUSED', 'CLI_REFUSED', 'CREDENTIALS_REQUIRED', 'CREDENTIAL_MUTATION_BLOCKED', 'UNKNOWN_CLI_FAILURE']);
let lastCode = 'UNKNOWN_CLI_FAILURE';
function refuse(code) { lastCode = code; throw new Error('IOS_BUILD_REFUSED'); }
const block = () => refuse('CREDENTIAL_MUTATION_BLOCKED');

function assertInvocation(env, head, args = [], execArgs = []) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
      || env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_REF !== REF
      || env.GITHUB_WORKFLOW !== 'Phone11 Siprix iOS internal build'
      || !/^[a-f0-9]{40}$/.test(head ?? '') || env.GITHUB_SHA !== head
      || env.PHONE11_IOS_BUILD_SOURCE !== head || env.PHONE11_BUILD_PROFILE !== PROFILE
      || args.length || execArgs.length) refuse('INVOCATION_REFUSED');
  for (const key of ['NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_USE_ENV_PROXY',
    'EAS_NO_VCS', 'EAS_BUILD_PROFILE', 'PHONE11_SIPRIX_LICENSE', 'EXPO_API_HOST', 'EXPO_STAGING', 'EXPO_LOCAL',
    'EXPO_ASC_API_KEY_PATH', 'EXPO_ASC_KEY_ID', 'EXPO_ASC_ISSUER_ID', 'EXPO_APPLE_ID', 'EXPO_APPLE_PASSWORD']) {
    if (env[key]) refuse('INVOCATION_REFUSED');
  }
}
function resolveProfile(eas, name = PROFILE, seen = new Set()) {
  if (seen.has(name) || seen.size > 5 || !eas.build?.[name]) refuse('CONFIG_REFUSED');
  seen.add(name); const own = eas.build[name];
  const base = own.extends ? resolveProfile(eas, own.extends, seen) : {};
  return { ...base, ...own, env: { ...base.env, ...own.env }, ios: { ...base.ios, ...own.ios } };
}
function assertSourceConfig(eas, appSource) {
  const p = resolveProfile(eas);
  const expected = { PHONE11_BUNDLE_ID: BUNDLE, EXPO_PUBLIC_API_BASE_URL: 'https://api.phone11.ai',
    EXPO_PUBLIC_DEEP_LINK_SCHEME: 'phone11', EXPO_PUBLIC_SIP_ENGINE: 'siprix', PHONE11_VOIP_WAKE_COMMISSIONED: '1',
    PHONE11_APNS_ENVIRONMENT: 'production', PHONE11_CHAT_NOTIFICATIONS_COMMISSIONED: '1' };
  if (eas.cli?.appVersionSource !== 'remote' || p.distribution !== 'internal' || p.channel !== 'siprix-daily-pilot'
      || p.developmentClient === true || p.autoIncrement !== true || p.ios.image !== 'macos-sequoia-15.6-xcode-26.0'
      || (p.credentialsSource !== undefined && p.credentialsSource !== 'remote')
      || (p.ios.credentialsSource !== undefined && p.ios.credentialsSource !== 'remote')
      || (p.ios.enterpriseProvisioning !== undefined && p.ios.enterpriseProvisioning !== 'adhoc')
      || p.ios.simulator === true || p.simulator === true || p.ios.withoutCredentials || p.withoutCredentials
      || (p.ios.buildConfiguration !== undefined && p.ios.buildConfiguration !== 'Release')
      || Object.entries(expected).some(([k,v]) => p.env[k] !== v)
      || ['PHONE11_SIPRIX_LICENSE', 'PHONE11_APP_STORE_BUILD', 'PHONE11_ANDROID_FOREGROUND_TRIAL',
        'EXPO_PUBLIC_PHONE11_ANDROID_FOREGROUND_TRIAL', 'PHONE11_ANDROID_SCREEN_TRANSACTION',
        'EXPO_PUBLIC_PHONE11_ANDROID_SCREEN_TRANSACTION'].some(k => p.env[k] && p.env[k] !== '0')
      || !appSource.includes(`projectId: "${PROJECT}"`)) refuse('CONFIG_REFUSED');
  return p;
}
function assertExpoConfig(exp) {
  if (exp.slug !== 'phone11ai' || exp.ios?.bundleIdentifier !== BUNDLE || exp.version !== '1.0.0'
      || exp.runtimeVersion !== '1.0.0-siprix-daily-pilot-chat-media-2' || exp.updates?.enabled !== false
      || exp.newArchEnabled !== false || exp.extra?.eas?.projectId !== PROJECT
      || exp.extra?.buildInfo?.sipEngine !== 'siprix' || exp.extra.buildInfo.sipSdkVersion !== '1.0.40-trial'
      || exp.extra.buildInfo.appStoreBuild !== false || exp.extra.phone11ChatNotificationsEnabled !== true
      || exp.extra.phone11ApnsEnvironment !== 'production' || exp.ios.entitlements?.['aps-environment'] !== 'production'
      || exp.extra.buildInfo.androidForegroundTrial || exp.extra.buildInfo.androidScreenTransaction) refuse('CONFIG_REFUSED');
}

function freezeIosProvider({ Provider, Utils, Api, validate, parse, Context, AppleApi, Setup, adHoc }) {
  if (adHoc !== 'AD_HOC' || typeof Provider?.prototype?.getRemoteAsync !== 'function'
      || typeof Provider.prototype.getLocalAsync !== 'function' || typeof Provider.prototype.getPushKeyAsync !== 'function'
      || typeof Utils?.getBuildCredentialsAsync !== 'function' || typeof Utils.assignBuildCredentialsAsync !== 'function'
      || typeof Api?.getIosAppCredentialsWithBuildCredentialsAsync !== 'function'
      || typeof validate !== 'function' || typeof parse !== 'function'
      || typeof Context?.prototype?.bestEffortAppStoreAuthenticateAsync !== 'function'
      || typeof AppleApi?.prototype?.ensureAuthenticatedAsync !== 'function' || typeof Setup?.prototype?.runAsync !== 'function') refuse('CLI_REFUSED');
  const read = Api.getIosAppCredentialsWithBuildCredentialsAsync;
  // Only this two-query remote read survives; no create-or-get identifier helper.
  for (const [name, fn] of Object.entries(Api)) if (typeof fn === 'function') Api[name] = block;
  Api.getIosAppCredentialsWithBuildCredentialsAsync = async (client, app, filter) => {
    if (app.account?.name !== 'vasavas' || app.projectName !== 'phone11ai' || app.bundleIdentifier !== BUNDLE
        || app.parentBundleIdentifier || filter?.iosDistributionType !== adHoc) refuse('CREDENTIALS_REQUIRED');
    const response = await read(client, app, { iosDistributionType: adHoc });
    if (!response || !Array.isArray(response.iosAppBuildCredentialsList) || response.iosAppBuildCredentialsList.length !== 1) refuse('CREDENTIALS_REQUIRED');
    return response;
  };
  Utils.assignBuildCredentialsAsync = block;
  Context.prototype.bestEffortAppStoreAuthenticateAsync = block;
  AppleApi.prototype.ensureAuthenticatedAsync = block;
  Setup.prototype.runAsync = block;
  Provider.prototype.getLocalAsync = block;
  Provider.prototype.getPushKeyAsync = async function(ctx) {
    if (!ctx.nonInteractive || !ctx.freezeCredentials) block();
    return null;
  };
  Provider.prototype.getRemoteAsync = async function() {
    const { ctx, options } = this;
    if (!ctx.nonInteractive || !ctx.freezeCredentials || ctx.refreshAdHocProvisioningProfile || ctx.appStore?.authCtx || ctx.ios !== Api
        || options.distribution !== 'internal' || (options.enterpriseProvisioning && options.enterpriseProvisioning !== 'adhoc')
        || !Array.isArray(options.targets) || options.targets.length !== 1
        || options.app?.account?.name !== 'vasavas' || options.app?.projectName !== 'phone11ai') refuse('CREDENTIALS_REQUIRED');
    if (await ctx.getProjectIdAsync() !== PROJECT) refuse('CREDENTIALS_REQUIRED');
    assertExpoConfig(await ctx.getExpoConfigAsync());
    const target = options.targets[0];
    if (target.bundleIdentifier !== BUNDLE || target.parentBundleIdentifier
        || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(target.targetName ?? '')
        || target.targetName === '__proto__' || target.targetName === 'constructor') refuse('CREDENTIALS_REQUIRED');
    const app = { ...options.app, bundleIdentifier: BUNDLE };
    const existing = await Utils.getBuildCredentialsAsync(ctx, app, adHoc);
    const cert = existing?.distributionCertificate;
    const profile = existing?.provisioningProfile;
    if (existing?.iosDistributionType !== adHoc || ctx.appStore?.authCtx
        || typeof cert?.certificateP12 !== 'string' || !cert.certificateP12 || cert.certificateP12.length > 1048576
        || typeof cert.certificatePassword !== 'string' || cert.certificatePassword.length > 4096
        || typeof profile?.provisioningProfile !== 'string' || !profile.provisioningProfile || profile.provisioningProfile.length > 1048576
        || !Number.isFinite(Date.parse(cert.validityNotBefore)) || !Number.isFinite(Date.parse(cert.validityNotAfter))
        || Date.parse(cert.validityNotBefore) > Date.now() || Date.parse(cert.validityNotAfter) <= Date.now()) refuse('CREDENTIALS_REQUIRED');
    const plist = parse(profile.provisioningProfile);
    const ent = plist.Entitlements; const teams = plist.TeamIdentifier; const devices = plist.ProvisionedDevices;
    if (!Array.isArray(teams) || teams.length !== 1 || !/^[A-Z0-9]{10}$/.test(teams[0])
        || ent?.['application-identifier'] !== `${teams[0]}.${BUNDLE}`
        || ent['com.apple.developer.team-identifier'] !== teams[0] || ent['aps-environment'] !== 'production'
        || ent['get-task-allow'] !== false || plist.ProvisionsAllDevices === true
        || !Array.isArray(devices) || !devices.length || devices.length > 1000
        || devices.some(d => typeof d !== 'string' || !/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{8}-[a-fA-F0-9]{16})$/.test(d))
        || new Set(devices).size !== devices.length || !Number.isFinite(Date.parse(plist.ExpirationDate))
        || Date.parse(plist.ExpirationDate) <= Date.now()
        || await validate(ctx, target, app, existing) !== true) refuse('CREDENTIALS_REQUIRED');
    // Preserve the original secret bytes and expected target map; never serialize.
    return { [target.targetName]: { distributionCertificate: { certificateP12: cert.certificateP12,
      certificatePassword: cert.certificatePassword }, provisioningProfile: profile.provisioningProfile } };
  };
}

function resolveCliRoot(env) {
  try {
    if (!isAbsolute(env.RUNNER_TOOL_CACHE ?? '')) refuse('CLI_REFUSED');
    const cache = realpathSync(env.RUNNER_TOOL_CACHE);
    const slot = join(cache, 'eas-cli', '23.2.0', process.arch);
    if (realpathSync(slot) !== slot) refuse('CLI_REFUSED');
    const root = realpathSync(join(slot, 'node_modules', 'eas-cli'));
    for (const file of ['', 'package.json', 'bin/run', ...Object.keys(CLI_FILES)]) {
      const within = relative(slot, realpathSync(join(root, file)));
      if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) refuse('CLI_REFUSED');
    }
    return root;
  } catch { refuse('CLI_REFUSED'); }
}
function installGuard(root) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (pkg.name !== 'eas-cli' || pkg.version !== '23.2.0' || pkg.bin?.eas !== './bin/run') refuse('CLI_REFUSED');
  for (const [file, digest] of Object.entries(CLI_FILES)) {
    if (createHash('sha256').update(readFileSync(join(root, file))).digest('hex') !== digest) refuse('CLI_REFUSED');
  }
  const load = path => require(join(root, path));
  freezeIosProvider({ Provider: load('build/credentials/ios/IosCredentialsProvider.js').default,
    Utils: load('build/credentials/ios/actions/BuildCredentialsUtils.js'), Api: load('build/credentials/ios/api/GraphqlClient.js'),
    validate: load('build/credentials/ios/validators/validateProvisioningProfile.js').validateProvisioningProfileAsync,
    parse: load('build/credentials/ios/utils/provisioningProfile.js').parse,
    Context: load('build/credentials/context.js').CredentialsContext,
    AppleApi: load('build/credentials/ios/appstore/AppStoreApi.js').default,
    Setup: load('build/credentials/ios/actions/SetUpBuildCredentials.js').SetUpBuildCredentials,
    adHoc: load('build/graphql/generated.js').IosDistributionType.AdHoc });
  return root;
}
function checkSource(env, args = [], execArgs = []) {
  const cwd = resolve(__dirname, '..');
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3000, maxBuffer: 128 });
  const head = git(['rev-parse', 'HEAD']).trim();
  assertInvocation(env, head, args, execArgs);
  git(['diff', '--quiet']); git(['diff', '--cached', '--quiet']);
  assertSourceConfig(JSON.parse(readFileSync(join(cwd, 'eas.json'), 'utf8')), readFileSync(join(cwd, 'app.config.ts'), 'utf8'));
  return head;
}
module.exports = { PROFILE, PROJECT, BUNDLE, REPOSITORY, REF, CLI_FILES, FAILURE_CODES,
  assertInvocation, assertSourceConfig, assertExpoConfig, freezeIosProvider, resolveCliRoot, installGuard, checkSource };
if (require.main === module) {
  let invoked = false;
  process.once('exit', code => { if (code !== 0) {
    try { writeSync(3, JSON.stringify({ failureCode: lastCode, requestMayHaveOccurred: invoked }) + '\n'); } catch { /* Parent refuses without a trusted diagnostic. */ }
  } });
  try {
    checkSource(process.env, process.argv.slice(2), process.execArgv);
    const root = installGuard(resolveCliRoot(process.env));
    process.argv = [process.execPath, join(root, 'bin/run'), 'build', '--platform', 'ios', '--profile', PROFILE,
      '--non-interactive', '--freeze-credentials', '--wait', '--json'];
    invoked = true;
    require(join(root, 'bin/run'));
  } catch { process.exitCode = 1; }
}
