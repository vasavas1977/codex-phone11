import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PROJECT = 'e354ffd3-485c-49f1-9e6f-aebe571d8dfb';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const refuse = () => { throw new Error('E_ANDROID_TRIAL_BUILD_RESULT'); };

export function validateBuildResult(value, source) {
  if (!/^[a-f0-9]{40}$/.test(source ?? '') || !Array.isArray(value) || value.length !== 1) refuse();
  const build = value[0];
  if (!build || !uuid.test(build.id ?? '') || build.status !== 'FINISHED'
      || build.gitCommitHash !== source || build.platform !== 'ANDROID'
      || build.distribution !== 'INTERNAL' || build.buildProfile !== 'preview-android-siprix-foreground-trial'
      || build.app?.id !== PROJECT || build.app?.slug !== 'phone11ai'
      || build.app?.ownerAccount?.name !== 'vasavas'
      || build.appIdentifier !== 'ai.phone11.mobile.foregroundtrial'
      || build.appVersion !== '1.0.0' || !/^[1-9][0-9]*$/.test(build.appBuildVersion ?? '')
      || build.error != null) refuse();
  let artifact;
  try { artifact = new URL(build.artifacts?.buildUrl); } catch { refuse(); }
  if (artifact.protocol !== 'https:' || artifact.hostname !== 'expo.dev'
      || !artifact.pathname.startsWith('/artifacts/eas/') || !artifact.pathname.endsWith('.apk')
      || artifact.username || artifact.password || artifact.port || artifact.search || artifact.hash) refuse();
  return { id: build.id, status: build.status, platform: build.platform, gitCommitHash: source,
    buildProfile: build.buildProfile, distribution: build.distribution,
    appIdentifier: build.appIdentifier, appVersion: build.appVersion, appBuildVersion: build.appBuildVersion,
    buildDetailsUrl: `https://expo.dev/accounts/vasavas/projects/phone11ai/builds/${build.id}`,
    artifactAvailable: true, artifactVerified: false, installed: false, physicalAcceptance: false,
    trialOnly: true, foregroundOnly: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) refuse();
    const bytes = readFileSync(process.argv[2]);
    if (bytes.length < 1 || bytes.length > 2 * 1024 * 1024) refuse();
    console.log(JSON.stringify(validateBuildResult(JSON.parse(bytes.toString('utf8')), process.argv[3]), null, 2));
  } catch { console.error('Phone11 Android build result refused; no artifact or credential data logged.'); process.exitCode = 1; }
}
