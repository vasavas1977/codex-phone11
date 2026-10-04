import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const moduleRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('Android isolated callback, lease, account, call, request, logout and failure state contracts',()=>{
  const out=mkdtempSync(path.join(tmpdir(),'phone11-android-state-'));
  try {
    execFileSync('javac',['-Xlint:all','-Werror','-d',out,path.join(moduleRoot,'android/src/main/java/ai/phone11/siprix/Phone11CallRuntime.java'),path.join(moduleRoot,'android/src/main/java/ai/phone11/siprix/Phone11ForegroundTrial.java'),path.join(moduleRoot,'tests/android-runtime.java')],{encoding:'utf8'});
    const result=execFileSync('java',['-cp',out,'ai.phone11.siprix.AndroidRuntimeTest'],{encoding:'utf8'});
    assert.match(result,/PASS \d+ isolated Android state assertions/);console.log(result.trim());
  } finally {rmSync(out,{recursive:true,force:true});}
});
