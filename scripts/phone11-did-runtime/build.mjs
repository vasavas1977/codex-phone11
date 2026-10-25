/** Exact DID-only receiver build. No runtime starts or private input is read. */
import fs from 'node:fs';
import {Buffer} from 'node:buffer';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..');
const require=createRequire(path.join(root,'package.json')),{build}=require('esbuild'),ts=require('typescript');
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
const args=process.argv.slice(2);if(args.length&&JSON.stringify(args)!=='["--freeze-source-pins"]')throw Error('BUILD_ARGUMENTS_REFUSED');
const freeze=args.length===1,pinPath=path.join(here,'SOURCE-PINS.json');if(freeze&&fs.existsSync(pinPath))throw Error('PINS_ALREADY_EXIST');
const attestationPath='scripts/phone11-retained-runtime/bound.ts',raw=fs.readFileSync(path.join(root,attestationPath),'utf8');
const parsed=ts.createSourceFile(attestationPath,raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const selected=['requiredAuthority','attestOwnedPool'].map(name=>{
 const found=parsed.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);if(found.length!==1)throw Error('EXACT_ATTESTATION_FUNCTION_REFUSED');return raw.slice(found[0].getStart(parsed),found[0].end);
});
// These function bodies (including SQL) are exact retained source, not a fork.
const virtual=`import {isIP} from 'node:net';\nimport {getPool} from 'phone11-maintained/db';\nimport type {PrivateRetainedBinding} from './scripts/phone11-retained-runtime/bound';\n${selected.map(s=>'export '+s).join('\n')}\n`;
const result=await build({absWorkingDir:root,entryPoints:['scripts/phone11-did-runtime/listener.ts'],write:false,bundle:true,platform:'node',format:'cjs',packages:'external',metafile:true,logLevel:'error',plugins:[{name:'exact-did-graph',setup(b){
 b.onResolve({filter:/^phone11-maintained\/db$/},()=>({path:path.join(root,'server/pbx/db.ts')}));
 b.onResolve({filter:/^phone11-maintained\/pool-attestation$/},()=>({path:'exact-retained-attestation',namespace:'did-attestation'}));
 b.onLoad({filter:/.*/,namespace:'did-attestation'},()=>({contents:virtual,loader:'ts',resolveDir:root}));
}}]});
const inputs=Object.keys(result.metafile.inputs).filter(name=>!name.startsWith('did-attestation:')).map(name=>{
 const file=path.resolve(root,name),relative=path.relative(root,file);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('SOURCE_SCOPE');const body=fs.readFileSync(file);return{path:relative,bytes:body.length,sha256:sha(body)};
});
inputs.push({path:attestationPath,bytes:Buffer.byteLength(raw),sha256:sha(raw)});inputs.sort((a,b)=>a.path.localeCompare(b.path));
const forbidden=['server/_core/index.ts','server/routers.ts','server/routers/index.ts','server/db.ts','server/esl.ts','server/pbx/redis.ts','server/_core/trpc.ts'];
if(inputs.some(i=>forbidden.includes(i.path))||inputs.filter(i=>i.path==='server/pbx/db.ts').length!==1)throw Error('DID_GRAPH_REFUSED');
const factoryPins={'server/pbx/did-route-target.ts':'6e79aa53b83307305b9c554fe85810e93da30aabe9d5ef2e1299a8c2f582509c','server/pbx/integration-auth.ts':'3705b0ee6f59014e7d24fbe62978568ee6d536137ecc70287b561514d30c91f6','server/pbx/kamailio-routing.ts':'eddf5356fed707d63092421423c24df6591d97de9e79d1969b3854203b194132'};
if(Object.entries(factoryPins).some(([name,pin])=>inputs.find(i=>i.path===name)?.sha256!==pin))throw Error('PG16_QUALIFIED_FACTORY_SOURCE_DRIFT');
const pins={qualifiedRoutingFactorySha256:'575d8c88bd640e24622fd5798d4c2e99f66c77e54772394c2c5655110dbd3704',schema:'PHONE11_DID_RUNTIME_SOURCE_PINS_V1',inputs,attestation:{source:attestationPath,virtualSha256:sha(virtual),functionSha256:selected.map(s=>sha(s))}};
if(freeze)fs.writeFileSync(pinPath,JSON.stringify(pins,null,2)+'\n');else if(JSON.stringify(pins)!==JSON.stringify(JSON.parse(fs.readFileSync(pinPath))))throw Error('REVIEWED_SOURCE_DRIFT');
const directory=path.join(root,'.cache/phone11-did-runtime');fs.mkdirSync(directory,{recursive:true});const output=result.outputFiles[0].contents;
fs.writeFileSync(path.join(directory,'did-listener.cjs'),output);
fs.writeFileSync(path.join(directory,'SOURCE-MANIFEST.json'),JSON.stringify({...pins,sourceOnly:true,listenerStarted:false,routingOnly:true,output:{bytes:output.length,sha256:sha(output)}},null,2)+'\n');
console.log(JSON.stringify({sourceFiles:inputs.length,output:'.cache/phone11-did-runtime/did-listener.cjs',bytes:output.length,sha256:sha(output),listenerStarted:false}));
