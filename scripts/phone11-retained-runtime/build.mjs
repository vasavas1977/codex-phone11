/** Reproduce the inert source library. This script never launches a runtime. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
if(process.argv.length!==2)throw Error('BUILD_ARGUMENTS_REFUSED');
const require=createRequire(path.join(root,'package.json'));
const {build}=require('esbuild');
const aliases={
 'runtime-role':'server/_core/runtime-role.ts','auth-routes':'server/_core/auth-routes.ts',
 'wake-routes':'server/push/wake-routes.ts','chat-media':'server/chat/media.ts',
 'recording-storage':'server/pbx/recording-storage.ts','auth':'server/_core/phone11-auth.ts',
 'db':'server/pbx/db.ts','wake-service':'server/push/wake-service.ts',
};
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const pinned=JSON.parse(fs.readFileSync(path.join(here,'SOURCE-PINS.json')));
const result=await build({absWorkingDir:root,entryPoints:['scripts/phone11-retained-runtime/bound.ts'],write:false,bundle:true,platform:'node',format:'cjs',packages:'external',metafile:true,logLevel:'error',
 plugins:[{name:'exact-maintained-bindings',setup(b){b.onResolve({filter:/^phone11-maintained\//},args=>{
  const file=aliases[args.path.slice('phone11-maintained/'.length)];if(!file)throw Error('UNKNOWN_MAINTAINED_IMPORT');return {path:path.join(root,file)};
 });}}]});
const inputs=Object.keys(result.metafile.inputs).map(file=>{
 const actual=path.resolve(root,file),relative=path.relative(root,actual);
 if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('UNEXPECTED_SOURCE_SCOPE');
 const bytes=fs.readFileSync(actual);return {path:relative,bytes:bytes.length,sha256:digest(bytes)};
}).sort((a,b)=>a.path.localeCompare(b.path));
const expected=[...pinned.inputs].sort((a,b)=>a.path.localeCompare(b.path));
if(JSON.stringify(inputs)!==JSON.stringify(expected))throw Error('REVIEWED_SOURCE_INPUT_DRIFT');
const forbidden=['server/_core/index.ts','server/routers.ts','server/routers/index.ts','server/_core/trpc.ts','server/esl.ts'];
if(inputs.some(i=>forbidden.includes(i.path))||inputs.filter(i=>i.path==='server/pbx/db.ts').length!==1)throw Error('RUNTIME_GRAPH_REFUSED');
const output=result.outputFiles[0].contents;
// Build outputs are always local and ignored. No private runtime input is read.
const directory=path.join(root,'.cache/phone11-retained-runtime');
fs.mkdirSync(directory,{recursive:true});
const manifest={schema:'PHONE11_MAINTAINED_RETAINED_BUILD_V1',sourceOnly:true,restrictedDatabaseProof:false,productionAcceptance:false,aliases,
 provenanceSha256:digest(fs.readFileSync(path.join(here,'PROVENANCE.json'))),inputs,
 output:{path:'retained-bound.cjs',bytes:output.length,sha256:digest(output)}};
fs.writeFileSync(path.join(directory,'retained-bound.cjs'),output);
fs.writeFileSync(path.join(directory,'SOURCE-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({output:'.cache/phone11-retained-runtime/retained-bound.cjs',sourceFiles:inputs.length,sha256:manifest.output.sha256,restrictedDatabaseProof:false}));
