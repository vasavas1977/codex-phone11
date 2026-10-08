// Public failure output is restricted to these literal, nonsecret messages.
const { constants, openSync, fstatSync, readSync, closeSync } = require('node:fs');
const { Buffer } = require('node:buffer');
const { isAbsolute, join } = require('node:path');
const SCHEMA = 'phone11.android-build-diagnostic.v1';
const MAX_BYTES = 512;
const messages = Object.freeze({
  E_ANDROID_EXISTING_CREDENTIALS_REQUIRED: 'Existing Android signing credentials are missing or unavailable.',
  E_ANDROID_LOCAL_CREDENTIALS_BLOCKED: 'Local Android signing credentials are blocked by the trial guard.',
  E_ANDROID_CREDENTIAL_GENERATION_BLOCKED: 'Creating or assigning Android signing credentials is blocked by the trial guard.',
  E_ANDROID_TRIAL_INVOCATION: 'The managed source, repository or invocation guard refused the request.',
  E_ANDROID_TRIAL_DIRTY_SOURCE: 'The managed source checkout is not clean.',
  E_ANDROID_TRIAL_CLI_CONTRACT: 'The pinned EAS credential-module interface did not match.',
  E_ANDROID_TRIAL_CLI_VERSION: 'The installed EAS CLI version did not match the pinned version.',
  E_ANDROID_TRIAL_CLI_BYTES: 'The pinned EAS credential-module bytes did not match.',
  E_ANDROID_TRIAL_CLI_LOCATION: 'The managed EAS CLI installation could not be located safely.',
  E_ANDROID_TRIAL_ARGUMENTS: 'Unexpected build-wrapper arguments were refused.',
  E_ANDROID_TRIAL_PROFILE: 'The fixed internal foreground trial profile did not match.',
  E_ANDROID_TRIAL_PROJECT: 'The fixed Phone11 Expo project did not match.',
  UNKNOWN_CLI_FAILURE: 'The protected CLI failed without a recognized wrapper diagnostic; the cause is unproven.',
});

function classifyDiagnostic(bytes) {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_BYTES) return 'UNKNOWN_CLI_FAILURE';
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'failureCode,schema'
        || value.schema !== SCHEMA || typeof value.failureCode !== 'string'
        || !Object.hasOwn(messages, value.failureCode)
        || JSON.stringify(value) + '\n' !== bytes.toString('utf8')) return 'UNKNOWN_CLI_FAILURE';
    return value.failureCode;
  } catch { return 'UNKNOWN_CLI_FAILURE'; }
}
function readManagedDiagnostic(env) {
  let descriptor;
  try {
    if (!isAbsolute(env.RUNNER_TEMP ?? '')) return Buffer.alloc(0);
    descriptor = openSync(join(env.RUNNER_TEMP, 'phone11-android-build-diagnostic.json'),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.size < 1 || info.size > MAX_BYTES) return Buffer.alloc(0);
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    return bytes.subarray(0, readSync(descriptor, bytes, 0, bytes.length, 0));
  } catch { return Buffer.alloc(0); }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

module.exports = { classifyDiagnostic, readManagedDiagnostic };
if (require.main === module) {
  const code = process.argv.length === 2
    ? classifyDiagnostic(readManagedDiagnostic(process.env)) : 'UNKNOWN_CLI_FAILURE';
  console.error(`Phone11 Android internal build failed (${code}). ${messages[code]} Signing remains restricted to existing credentials.`);
}
