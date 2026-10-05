import { test } from 'node:test';
import assert from 'node:assert/strict';
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
