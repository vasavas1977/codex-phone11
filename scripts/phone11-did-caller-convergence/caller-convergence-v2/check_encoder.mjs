/** Actual maintained pure encoder conformance; never imports a runtime/pool. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../..');
const require=createRequire(path.join(root,'package.json'));
const source=fs.readFileSync(path.join(root,'server/pbx/did-route-target.ts'),'utf8');
const output=require('esbuild').transformSync(source,{loader:'ts',format:'cjs'}).code;
const module={exports:{}};new Function('module','exports',output)(module,module.exports);
const {encodeDidInternalTarget,decodeDidInternalTarget}=module.exports;
const transform=fs.readFileSync(path.join(here,'transform.py'),'utf8');
const pattern=name=>new RegExp(transform.match(new RegExp('^'+name+"=r'([^']+)'$",'m'))[1]);
const internal=pattern('INTERNAL_PATTERN'),ringall=pattern('RINGALL_PATTERN');
let checked=0;
for(const type of ['ivr','ringgroup','queue','timecondition','ringall']){
 for(const tenantId of [1,7,9999999999]){
  for(const targetId of [0,1,23,9999999999]){
   const target={type,tenantId,targetId};
   if(type==='ringall'?targetId!==0:targetId===0){assert.throws(()=>encodeDidInternalTarget(target));continue;}
   const encoded=encodeDidInternalTarget(target);
   assert.ok((type==='ringall'?ringall:internal).test(encoded));
   assert.deepEqual(decodeDidInternalTarget(encoded),target);checked++;
  }
 }
}
for(const invalid of ['phone11pbx-ivr-7-0','phone11pbx-ringall-7-1','phone11pbx-ivr-0-1','phone11pbx-ivr-10000000000-1','phone11pbx-unknown-7-1'])assert.ok(!internal.test(invalid)&&!ringall.test(invalid));
console.log(JSON.stringify({status:'PASS',actualMaintainedEncoderCases:checked,noRuntimeImports:true,vendorKamRuntimeProven:false}));
