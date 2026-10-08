// Public failure output is restricted to these literal, nonsecret messages.
const { constants, openSync, fstatSync, readSync, closeSync, lstatSync, realpathSync } = require('node:fs');
const { Buffer } = require('node:buffer');
const { isAbsolute, join, resolve } = require('node:path');
const SCHEMA = 'phone11.android-build-diagnostic.v1';
const MAX_BYTES = 512;
const PROGRESS_SCHEMA = 'phone11.android-build-progress.v1';
const PROGRESS_MAX_BYTES = 4096;
const PROGRESS_MAX_RECORDS = 128;
const PROGRESS_MILESTONES = Object.freeze([
  'SOURCE_CONFIG_VERIFIED', 'GUARD_INSTALLED', 'EAS_ENTRYPOINT_INVOKED',
  'REMOTE_READ_STARTED', 'REMOTE_READ_COMPLETED', 'CONVERSION_STARTED', 'CONVERSION_COMPLETED',
]);
const invalidProgress = Buffer.from('PROGRESS_UNAVAILABLE\n');
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

function summarizeProgress(bytes) {
  const summary = (status, lastObservedMilestone = null) => ({
    schema: PROGRESS_SCHEMA, status, lastObservedMilestone,
  });
  if (Buffer.isBuffer(bytes) && bytes.length === 0) return summary('UNAVAILABLE');
  if (!Buffer.isBuffer(bytes) || bytes.length > PROGRESS_MAX_BYTES) return summary('MALFORMED');
  const text = bytes.toString('utf8');
  if (!text.endsWith('\n')) return summary('MALFORMED');
  const records = text.slice(0, -1).split('\n');
  if (records.length > PROGRESS_MAX_RECORDS) return summary('MALFORMED');
  let expected = 0;
  for (const record of records) {
    if (record !== PROGRESS_MILESTONES[expected]) return summary('MALFORMED');
    // The fixed prelude occurs once. Read/convert cycles may repeat sequentially.
    // Overlapping starts, duplicate events and any out-of-order cycle refuse.
    expected = expected === PROGRESS_MILESTONES.length - 1 ? 3 : expected + 1;
  }
  return summary('OBSERVED_PREFIX', records.at(-1));
}
function readManagedProgress(env) {
  let descriptor;
  try {
    const directory = env.RUNNER_TEMP;
    if (!isAbsolute(directory ?? '') || !lstatSync(directory).isDirectory()
        || realpathSync(directory) !== resolve(directory)) return Buffer.alloc(0);
    descriptor = openSync(join(directory, 'phone11-android-build-progress.txt'),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.nlink !== 1 || info.size > PROGRESS_MAX_BYTES) return invalidProgress;
    const bytes = Buffer.alloc(PROGRESS_MAX_BYTES + 1);
    const count = readSync(descriptor, bytes, 0, bytes.length, 0);
    if (count !== info.size || fstatSync(descriptor).size !== info.size) return invalidProgress;
    return bytes.subarray(0, count);
  } catch { return Buffer.alloc(0); }
  finally { if (descriptor !== undefined) { try { closeSync(descriptor); } catch { /* No path/error output. */ } } }
}

module.exports = { classifyDiagnostic, readManagedDiagnostic, summarizeProgress, readManagedProgress,
  PROGRESS_MILESTONES, PROGRESS_MAX_RECORDS, PROGRESS_MAX_BYTES };
if (require.main === module) {
  const code = process.argv.length === 2
    ? classifyDiagnostic(readManagedDiagnostic(process.env)) : 'UNKNOWN_CLI_FAILURE';
  console.error(`Phone11 Android internal build failed (${code}). ${messages[code]} Signing remains restricted to existing credentials.`);
  // Independent observation only: neither a failed stage nor cloud-build status.
  const progress = process.argv.length === 2
    ? summarizeProgress(readManagedProgress(process.env)) : summarizeProgress(Buffer.alloc(0));
  console.error(JSON.stringify(progress));
}
