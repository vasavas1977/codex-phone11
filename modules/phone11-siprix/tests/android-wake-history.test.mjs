import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('completed native wake history validates identity and real AES-GCM storage without a device',()=>{
 const out=mkdtempSync(path.join(tmpdir(),'phone11-wake-history-'));
 try{execFileSync('javac',['-Xlint:all','-Werror','-d',out,path.join(root,'android/src/main/java/ai/phone11/siprix/Phone11WakeHistoryState.java'),path.join(root,'tests/android-wake-history.java')],{encoding:'utf8'});const result=execFileSync('java',['-cp',out,'ai.phone11.siprix.AndroidWakeHistoryTest'],{encoding:'utf8'});assert.match(result,/PASS \d+ encrypted completed-wake history assertions/);console.log(result.trim());}finally{rmSync(out,{recursive:true,force:true});}
});
test('Android history storage uses a separate device key and atomic no-backup ciphertext',()=>{
 const source=readFileSync(path.join(root,'android/src/main/java/ai/phone11/siprix/Phone11WakeHistory.java'),'utf8');
 assert.match(source,/getNoBackupFilesDir\(\)/);assert.match(source,/AndroidKeyStore/);assert.match(source,/phone11\.android\.completed-wake-history\.v1/);assert.match(source,/setRandomizedEncryptionRequired\(true\)/);assert.match(source,/Phone11WakeHistoryState\.encrypt/);assert.match(source,/file\.finishWrite\(out\)/);assert.match(source,/file\.failWrite\(out\)/);assert.doesNotMatch(source,/Log\.|System\.out|\.put\("(?:grant|password)"/);
 assert.ok(source.indexOf('keys.deleteEntry(KEY)')<source.indexOf('file.delete()'),'key destruction precedes file deletion');
});
