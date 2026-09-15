import {mkdtemp,mkdir,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=await mkdtemp(join(tmpdir(),'phone11-chat-notifications-'));await chmod(root,0o700);
const data=join(root,'data'),socket=join(root,'socket');await mkdir(socket,{mode:0o700});
const config=spawnSync('pg_config',['--bindir'],{encoding:'utf8'}),bin=process.env.PHONE11_TEST_PG_BIN||(config.status===0?config.stdout.trim():'/opt/homebrew/opt/postgresql@17/bin');
function run(cmd,args,options={}){const r=spawnSync(cmd,args,{encoding:'utf8',...options});if(r.status!==0)throw new Error(`${cmd} failed: ${r.stderr??''}`);return r;}
let started=false;
try{
 run(join(bin,'initdb'),['-D',data,'-U','phone11_test','--auth-local=trust','--auth-host=reject','--no-locale','-E','UTF8']);
 run(join(bin,'pg_ctl'),['-D',data,'-l',join(root,'postgres.log'),'-o',`-h '' -k ${socket}`,'-w','start']);started=true;
 run(join(bin,'createdb'),['-h',socket,'-U','phone11_test','phone11_chat_notification_test']);
 const r=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','tests/phone11-chat-notification-postgres.test.ts'],{stdio:'inherit',env:{...process.env,PHONE11_CHAT_NOTIFICATION_TEST_SOCKET:socket,NODE_ENV:'test'}});process.exitCode=r.status??1;
}finally{if(started)run(join(bin,'pg_ctl'),['-D',data,'-m','fast','-w','stop']);await rm(root,{recursive:true,force:true});}
