import {mkdtemp,mkdir,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=await mkdtemp(join(tmpdir(),'phone11-cloud-recordings-'));await chmod(root,0o700);
const data=join(root,'data'),socket=join(root,'socket');await mkdir(socket,{mode:0o700});
const config=spawnSync('pg_config',['--bindir'],{encoding:'utf8'}),bin=process.env.PHONE11_TEST_PG_BIN||(config.status===0?config.stdout.trim():'/opt/homebrew/opt/postgresql@17/bin');
function run(cmd,args,options={}){const r=spawnSync(cmd,args,{encoding:'utf8',...options});if(r.status!==0)throw new Error(`${cmd} failed: ${r.stderr??''}`);return r;}
let started=false;
try{
 run(join(bin,'initdb'),['-D',data,'-U','phone11_test','--auth-local=trust','--auth-host=reject','--no-locale','-E','UTF8']);
 run(join(bin,'pg_ctl'),['-D',data,'-l',join(root,'postgres.log'),'-o',`-h '' -k ${socket}`,'-w','start']);started=true;
 for(const test of ['tests/phone11-cloud-recordings-postgres.test.ts','tests/phone11-route-cdr-postgres.test.ts']){
  run(join(bin,'createdb'),['-h',socket,'-U','phone11_test','phone11_cloud_recording_test']);
  const r=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run',test,'--maxWorkers=1','--minWorkers=1'],{stdio:'inherit',env:{...process.env,PHONE11_CLOUD_RECORDING_TEST_SOCKET:socket,NODE_ENV:'test'}});
  if(r.status!==0){process.exitCode=r.status??1;break;}
  run(join(bin,'dropdb'),['-h',socket,'-U','phone11_test','phone11_cloud_recording_test']);
 }
}finally{if(started)run(join(bin,'pg_ctl'),['-D',data,'-m','fast','-w','stop']);await rm(root,{recursive:true,force:true});}
