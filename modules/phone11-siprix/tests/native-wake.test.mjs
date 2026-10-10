import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
for (const gate of [0,1]) test(`actual native wake coordinator gate ${gate}: report-first, deferred Answer, ownership, cancellation and late completions`, {skip:process.platform!=='darwin'?'macOS required':false},()=>{
 const directory=mkdtempSync(path.join(root,'.native-test-'));
 try {
  const executable=path.join(directory,'wake');
  const build=spawnSync('clang',['-fobjc-arc','-fblocks','-Werror=objc-method-access','-Werror=protocol',`-DPHONE11_VOIP_WAKE_COMMISSIONED=${gate}`,'-I',path.join(root,'tests/stubs'),'-framework','Foundation','-framework','Security',path.join(root,'tests/native-wake.m'),'-o',executable],{encoding:'utf8',timeout:60000});
  assert.equal(build.status,0,build.stderr);
  const run=spawnSync(executable,[],{encoding:'utf8',timeout:10000});
  assert.equal(run.status,0,run.stderr); assert.match(run.stdout,/PASS: \d+ native wake assertions/); console.log(run.stdout.trim());
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('wake facade calls compile against current Siprix bridge and installed RNCallKeep public headers', {skip:process.platform!=='darwin'?'macOS required':false},()=>{
 const result=spawnSync('clang',['-fobjc-arc','-fblocks','-Wno-nullability-completeness','-Werror=objc-method-access','-Werror=protocol','-I',path.resolve(root,'../../node_modules/react-native-callkeep/ios'),'-I',path.join(root,'tests/stubs'),'-fsyntax-only',path.join(root,'ios/Phone11WakeCoordinator.m')],{encoding:'utf8',timeout:60000});
 assert.equal(result.status,0,result.stderr);
});
