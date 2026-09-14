const { withAppBuildGradle, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

const entryName = entry => entry?.$?.['android:name'];
const replaceNamedEntry = (entries = [], name, replacement) => [
 ...entries.filter(entry => entryName(entry) !== name),
 replacement,
];

function configureLabManifest(manifest) {
 manifest.$['xmlns:tools']='http://schemas.android.com/tools';
 const application=manifest.application[0];
 application.$['android:allowBackup']='false';
 application.$['android:networkSecurityConfig']='@xml/phone11_lab_network';
 application['meta-data']=replaceNamedEntry(
  application['meta-data'],
  'com.siprix.SkipPermissionRequest',
  {$:{'android:name':'com.siprix.SkipPermissionRequest','android:value':'true'}},
 );
 manifest['uses-permission']=replaceNamedEntry(
  manifest['uses-permission'],
  'android.permission.CAMERA',
  {$:{'android:name':'android.permission.CAMERA','tools:node':'remove'}},
 );
 return manifest;
}

const withPhone11AndroidLab = config => {
 if (process.env.PHONE11_ANDROID_LAB !== '1') throw new Error('Android lab plugin requires explicit flag');
 config = withAndroidManifest(config, c => {
  configureLabManifest(c.modResults.manifest);
  return c;
 });
 config = withDangerousMod(config,['android',async c=>{
  const dir=path.join(c.modRequest.platformProjectRoot,'app/src/main/res/xml');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'phone11_lab_network.xml'),`<network-security-config><base-config cleartextTrafficPermitted="false"/><domain-config cleartextTrafficPermitted="true"><domain includeSubdomains="false">10.0.2.2</domain><domain includeSubdomains="false">127.0.0.1</domain><domain includeSubdomains="false">localhost</domain></domain-config></network-security-config>`);
  return c;
 }]);
 return withAppBuildGradle(config,c=>{
  const line=`\ndependencies { implementation files("../../modules/phone11-siprix/vendor/android/siprix_voip_sdk.aar") }\n`;
  if(!c.modResults.contents.includes('vendor/android/siprix_voip_sdk.aar')) c.modResults.contents+=line;
  if(!c.modResults.contents.includes('// Phone11 lab ABI')) c.modResults.contents+='\n// Phone11 lab ABI: all bundled native dependencies must match the dedicated image.\nandroid { defaultConfig { ndk { abiFilters.clear(); abiFilters.add("arm64-v8a") } } }\n';
  return c;
 });
};

withPhone11AndroidLab.configureLabManifest = configureLabManifest;
module.exports = withPhone11AndroidLab;
