import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));

test('Swift bootstrap imports public Objective-C API through the declared module (React stub, no iOS link)', {
 skip:process.platform!=='darwin'?'Apple Swift compiler required':false,
},()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'phone11-swift-import-'));
 try {
  const podspec=readFileSync(path.join(root,'Phone11Siprix.podspec'),'utf8');
  assert.match(podspec,/'DEFINES_MODULE'\s*=>\s*'YES'/);
  // Match CocoaPods' generated umbrella/module map shape. This verifies the
  // actual public headers and Swift selector, not CocoaPods installation/linking.
  const umbrella=path.join(dir,'Phone11Siprix-umbrella.h');
  writeFileSync(umbrella,['Phone11Siprix.h','Phone11VoipPush.h'].map(name=>`#import "${path.join(root,'ios',name)}"`).join('\n'));
  writeFileSync(path.join(dir,'module.modulemap'), 'module Phone11Siprix { umbrella header "Phone11Siprix-umbrella.h" export * module * { export * } }\n');
  const swift=path.join(dir,'Bootstrap.swift');
  writeFileSync(swift,'import Phone11Siprix\nfunc bootstrapPhone11() { Phone11VoipPush.bootstrap() }\n');
  const result=spawnSync('swiftc',['-typecheck','-module-cache-path',path.join(dir,'cache'),'-I',dir,'-I',path.join(root,'tests/stubs'),swift],{encoding:'utf8',timeout:60000});
  assert.equal(result.status,0,result.error?.message??result.stderr);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
