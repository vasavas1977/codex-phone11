import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {injectBootstrap,wakeOrigin}=require('../plugins/with-phone11-voip-wake.js');
const source='import Expo\nclass AppDelegate: ExpoAppDelegate {\n override func application(\n _ application: UIApplication,\n didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil\n ) -> Bool {\n let factory = ExpoReactNativeFactory(delegate: delegate)\n return true\n }\n}';
test('Swift native bootstrap precedes React factory and is idempotent',()=>{const result=injectBootstrap(source);assert.ok(result.indexOf('Phone11VoipPush.bootstrap()')<result.indexOf('let factory'));assert.equal(injectBootstrap(result),result);assert.match(result,/import Phone11Siprix/);});
test('changed launch signature is rejected instead of silently losing cold wake',()=>assert.throws(()=>injectBootstrap('class AppDelegate {}')));
test('native wake origin rejects redirects, paths, credentials and insecure schemes',()=>{assert.equal(wakeOrigin('https://api.phone11.ai/'),'https://api.phone11.ai');for(const value of ['http://api.phone11.ai','https://user:secret@api.phone11.ai','https://api.phone11.ai/path','https://api.phone11.ai?x=y','https://api.phone11.ai#x'])assert.throws(()=>wakeOrigin(value));});
