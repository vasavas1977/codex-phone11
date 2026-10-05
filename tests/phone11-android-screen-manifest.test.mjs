import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verifyManifest } from '../scripts/verify-phone11-android-screen-manifest.mjs';
const owner = 'com.oney.WebRTCModule.Phone11ScreenProjectionService';
const gate = '<meta-data android:name="ai.phone11.meeting.SCREEN_TRANSACTION" android:value="true"/>';
const service = `<service android:name="${owner}" android:exported="false" android:foregroundServiceType="mediaProjection"/>`;
const permission = '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION"/>';
const document = (body = '', grant = '') => `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.oney.WebRTCModule">${grant}<application>${body}<service android:name="com.oney.WebRTCModule.MediaProjectionService"/></application></manifest>`;
const on = document(gate + service, permission);
test('OFF permits the existing unrelated released projection service', () => { assert.equal(verifyManifest(document(), 'off').serviceCount, 0); });
test('ON accepts exactly one private video-only service and literal gate', () => { assert.equal(verifyManifest(on, 'on').serviceCount, 1); });
for (const [label, value] of Object.entries({
  applicationDisabled: on.replace('<application>', '<application android:enabled="false">'),
  applicationResource: on.replace('<application>', '<application android:enabled="@bool/disabled">'),
  serviceDisabled: on.replace('android:exported="false"', 'android:exported="false" android:enabled="false"'),
  serviceResource: on.replace('android:exported="false"', 'android:exported="false" android:enabled="@bool/disabled"'),
  exported: on.replace('exported="false"', 'exported="true"'),
  audio: on.replace('Type="mediaProjection"', 'Type="mediaProjection|microphone"'),
  duplicateService: document(gate + service + service, permission),
  duplicateGate: document(gate + gate + service, permission),
  duplicatePermission: document(gate + service, permission + permission),
  duplicateAttribute: on.replace('exported="false"', 'exported="false" android:exported="true"'),
  namespaceAliasDuplicate: on.replace('exported="false"', 'exported="false" a:exported="false"').replace('<manifest ', '<manifest xmlns:a="http://schemas.android.com/apk/res/android" '),
  missingGate: document(service, permission),
  wrongOwner: document(service + `<activity android:name="A">${gate}</activity>`, permission),
  resourceGate: on.replace('android:value="true"', 'android:value="true" android:resource="@bool/true"'),
  limitedPermission: on.replace('/><application>', ' android:maxSdkVersion="28"/><application>'),
  secondApplication: on.replace('</manifest>', '<application/></manifest>'),
  filters: on.replace('Type="mediaProjection"/>', 'Type="mediaProjection"><intent-filter/></service>'),
  malformed: on.slice(0, -11),
  doctype: '<!DOCTYPE manifest [<!ENTITY foo "bar">]>' + on,
})) test(`refuses ${label}`, () => assert.throws(() => verifyManifest(value, 'on')));
test('relative class aliases are still owned', () => { assert.throws(() => verifyManifest(document(service.replace(owner, '.Phone11ScreenProjectionService')), 'off')); });
test('OFF refuses retained ON wiring and unknown modes', () => { assert.throws(() => verifyManifest(on, 'off')); assert.throws(() => verifyManifest(on, 'unknown')); });

test('ON accepts literal true application and service enablement', () => { assert.equal(verifyManifest(on.replace('<application>', '<application android:enabled="true">').replace('android:exported="false"', 'android:exported="false" android:enabled="true"'), 'on').serviceCount, 1); });

test('symlink CLI validates positive input and rejects missing file, invalid mode and arity', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'phone11-screen-manifest-cli-'));
  try {
    const script = fileURLToPath(new URL('../scripts/verify-phone11-android-screen-manifest.mjs', import.meta.url));
    const alias = path.join(scratch, 'aliased-verifier.mjs'), file = path.join(scratch, 'AndroidManifest.xml');
    symlinkSync(script, alias); writeFileSync(file, on);
    const invoke = args => spawnSync(process.execPath, [alias, ...args], { encoding: 'utf8' });
    const valid = invoke([file, 'on']); assert.equal(valid.status, 0, valid.stderr); assert.equal(JSON.parse(valid.stdout).serviceCount, 1);
    for (const args of [[path.join(scratch, 'missing.xml'), 'on'], [file, 'invalid'], [], [file], [file, 'on', 'extra']]) {
      const result = invoke(args); assert.equal(result.status, 1, result.stdout + result.stderr); assert.notEqual(result.stderr, '');
    }
    writeFileSync(file, document()); assert.equal(invoke([file, 'on']).status, 1);
    assert.equal(invoke([file, 'off']).status, 0);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
