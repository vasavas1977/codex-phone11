import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const {injectBootstrap,wakeOrigin}=require('../plugins/with-phone11-voip-wake.js');
const source='import Expo\nclass AppDelegate: ExpoAppDelegate {\n override func application(\n _ application: UIApplication,\n didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil\n ) -> Bool {\n let factory = ExpoReactNativeFactory(delegate: delegate)\n return true\n }\n}';
test('Swift native bootstrap precedes React factory and is idempotent',()=>{const result=injectBootstrap(source);assert.ok(result.indexOf('Phone11VoipPush.bootstrap()')<result.indexOf('let factory'));assert.equal(injectBootstrap(result),result);assert.match(result,/import Phone11Siprix/);});
test('changed launch signature is rejected instead of silently losing cold wake',()=>assert.throws(()=>injectBootstrap('class AppDelegate {}')));
test('native wake origin rejects redirects, paths, credentials and insecure schemes',()=>{assert.equal(wakeOrigin('https://api.phone11.ai/'),'https://api.phone11.ai');for(const value of ['http://api.phone11.ai','https://user:secret@api.phone11.ai','https://api.phone11.ai/path','https://api.phone11.ai?x=y','https://api.phone11.ai#x'])assert.throws(()=>wakeOrigin(value));});

const generated = readFileSync(new URL('./fixtures/expo54-AppDelegate.swift', import.meta.url), 'utf8');
test('actual Expo 54 delegate gets one early bootstrap while super and linking methods remain unchanged', () => {
  const result = injectBootstrap(generated);
  assert.equal(result.split('Phone11VoipPush.bootstrap()').length, 2);
  assert.ok(result.indexOf('Phone11VoipPush.bootstrap()') < result.indexOf('let delegate = ReactNativeDelegate()'));
  assert.equal(injectBootstrap(result), result);
  const restored = result.replace(/^import Phone11Siprix\n/, '').replace(
    '\n    // Phone11 native incoming wake bootstrap (commissioning gate remains native-only).\n    Phone11VoipPush.bootstrap()', '');
  assert.equal(restored, generated);
});
test('super launch call followed by another application method is not a launch declaration', () => {
  const callOnly = generated.replace('didFinishLaunchingWithOptions launchOptions:', 'changedLaunchOptions launchOptions:');
  assert.throws(() => injectBootstrap(callOnly), /reviewed Swift AppDelegate launch signature/);
});
test('multiple launch declarations fail closed', () => {
  assert.throws(() => injectBootstrap(generated + '\n' + generated), /reviewed Swift AppDelegate launch signature/);
});
test('existing module import is reused without duplication', () => {
  const result = injectBootstrap('import Phone11Siprix\n' + generated);
  assert.equal(result.split('import Phone11Siprix').length, 2);
  assert.equal(injectBootstrap(result), result);
});
test('incomplete or misplaced existing bootstrap fails closed', () => {
  const result = injectBootstrap(generated);
  for (const changed of [result.replace('import Phone11Siprix\n', ''), result.replace('Phone11VoipPush.bootstrap()', ''),
    result.replace('    Phone11VoipPush.bootstrap()', '') + '\nPhone11VoipPush.bootstrap()']) {
    assert.throws(() => injectBootstrap(changed), /incomplete or misplaced/);
  }
});
