import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const framework=path.join(root,'vendor/siprix.xcframework/ios-arm64');
test('default-off native warm-transfer candidate uses pinned selectors and owned async lifecycle',{
  skip:process.platform!=='darwin'?'macOS Command Line Tools required':false,
},()=>{
  assert.ok(existsSync(path.join(framework,'siprix.framework/Headers/Siprix.h')),'Retained pinned SDK required');
  const dir=mkdtempSync(path.join(root,'.native-warm-test-'));
  try {
    const exe=path.join(dir,'native-warm-runtime');
    const build=spawnSync('clang',['-fobjc-arc','-fblocks','-Werror=objc-method-access','-Werror=protocol',
      '-Wno-incomplete-implementation','-DPHONE11_WARM_TRANSFER_SOURCE_ENABLED=1',
      '-include',path.join(root,'tests/stubs/prefix.h'),'-I',path.join(root,'tests/stubs'),'-F',framework,
      '-framework','Foundation',path.join(root,'tests/native-warm-runtime.m'),'-o',exe],{encoding:'utf8',timeout:60000});
    assert.equal(build.status,0,build.error?.message??build.stderr);
    const run=spawnSync(exe,[],{encoding:'utf8',timeout:15000});
    assert.equal(run.status,0,run.error?.message??run.stderr);
    assert.match(run.stdout,/PASS: \d+ warm consultation assertions/);
    console.log(run.stdout.trim());
  } finally {rmSync(dir,{recursive:true,force:true});}
});
