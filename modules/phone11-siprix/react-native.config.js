module.exports = {
 dependency: { platforms: {
  ios: { podspecPath: __dirname + '/Phone11Siprix.podspec' },
  android: process.env.PHONE11_ANDROID_LAB === '1' ? {
   sourceDir: __dirname + '/android',
   packageImportPath: 'import ai.phone11.siprix.Phone11SiprixPackage;',
   packageInstance: 'new Phone11SiprixPackage()',
  } : null,
 } },
};
