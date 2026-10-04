import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync,readFileSync,readdirSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {verifySdk} from '../android/verify-sdk.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const aar=process.env.PHONE11_SIPRIX_ANDROID_AAR,androidJar=process.env.PHONE11_ANDROID_API_JAR;
const javaFiles=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(item=>item.isDirectory()?javaFiles(path.join(dir,item.name)):item.name.endsWith('.java')?[path.join(dir,item.name)]:[]);
test('Actual official Siprix + Android API compiler binding; RN declaration stubs are a separate limited check',()=>{
  assert.ok(aar&&androidJar,'PHONE11_SIPRIX_ANDROID_AAR and PHONE11_ANDROID_API_JAR are required; this compiler gate never skips');
  assert.deepEqual(verifySdk(aar).abis,['arm64-v8a','armeabi-v7a','x86','x86_64']);
  const out=mkdtempSync(path.join(tmpdir(),'phone11-android-real-api-'));
  try{
    const siprix=path.join(out,'siprix.jar');writeFileSync(siprix,execFileSync('unzip',['-p',aar,'classes.jar'],{maxBuffer:1024*1024}));
    assert.equal(createHash('sha256').update(readFileSync(siprix)).digest('hex'),'4929fc4b157bb65b9739a8d872079975d369501c9b55ece7b4506a9c5ac6a1b0');
    const source=path.join(root,'android/src/main/java/ai/phone11/siprix');
    execFileSync('javac',['-Xlint:all','-Werror','-cp',`${siprix}${path.delimiter}${androidJar}`,'-d',path.join(out,'api'),path.join(source,'Phone11CallRuntime.java'),path.join(source,'SiprixAndroidAdapter.java')],{encoding:'utf8'});
    const config=path.join(out,'BuildConfig.java');writeFileSync(config,'package ai.phone11.siprix; public final class BuildConfig {public static final boolean FOREGROUND_SOURCE_ENABLED=false;}');
    execFileSync('javac',['-Xlint:all,-unchecked,-rawtypes','-cp',`${siprix}${path.delimiter}${androidJar}`,'-d',path.join(out,'rn-host-declarations'),...javaFiles(source),...javaFiles(path.join(root,'tests/android-stubs')),config],{encoding:'utf8'});
    console.log('PASS actual pinned SDK + Android API binding. RN host declaration check only; no full RN/Gradle/APK/runtime/device claim.');
  }finally{rmSync(out,{recursive:true,force:true});}
});
