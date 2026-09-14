import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {androidWakeBuildSettings,stagingAndroidPackage}=require('../../plugins/with-phone11-android-lab.js');

export const commissionedStagingNames=Object.freeze([
 'PHONE11_ANDROID_WAKE_COMMISSIONED','PHONE11_ANDROID_FIREBASE_COMMISSIONED',
 'PHONE11_ANDROID_WAKE_ENVIRONMENT','PHONE11_ANDROID_LAB_PACKAGE',
 'PHONE11_ANDROID_FIREBASE_PROJECT_ID','PHONE11_ANDROID_FIREBASE_APP_ID',
 'PHONE11_ANDROID_FIREBASE_SENDER_ID','PHONE11_ANDROID_GOOGLE_SERVICES_FILE',
 'PHONE11_ANDROID_SIP_HOST','PHONE11_ANDROID_SIP_PORT',
 'PHONE11_ANDROID_SIP_ACCOUNT_EXTENSIONS','PHONE11_ANDROID_SIP_DESTINATIONS',
 'EXPO_PUBLIC_API_BASE_URL',
]);

export function commissionedStagingEnv(source,cleanLabEnv,projectRoot){
 const env={...cleanLabEnv};
 for(const name of commissionedStagingNames){
  if(Object.hasOwn(source,name))env[name]=source[name];
 }
 const settings=androidWakeBuildSettings(env,{packageName:env.PHONE11_ANDROID_LAB_PACKAGE,projectRoot});
 return {env,settings,packageName:stagingAndroidPackage};
}
