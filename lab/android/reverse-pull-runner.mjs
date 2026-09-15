import {execFileSync} from 'node:child_process';
import {Buffer} from 'node:buffer';
import {pathToFileURL} from 'node:url';
import {createRealSipDriverService,readDriverConfig} from './real-sip-driver.mjs';

const cloudRun=/^https:\/\/phone11-fcm-staging-lab-(?:413228367517\.asia-southeast1|[a-z0-9]{10}-as\.a)\.run\.app$/;
const runnerAccount='phone11-sip-runner@phone11-stage-20260914.iam.gserviceaccount.com';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(Object.keys(value).sort())===JSON.stringify([...keys].sort());
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export class ReversePullRunnerError extends Error{constructor(){super('Private reverse-pull runner unavailable');}}

export function readReversePullRunnerConfig(source=process.env,now=Date.now()){
 const driver=readDriverConfig(source,now);
 const origin=String(source.PHONE11_LAB_FCM_PUBLIC_ORIGIN??'').replace(/\/$/,'');
 if(source.PHONE11_LAB_SIP_REVERSE_PULL_ENABLED!=='1'||source.PHONE11_LAB_SIP_REVERSE_PULL_ENVIRONMENT!=='staging'||source.PHONE11_LAB_SIP_DRIVER_TRANSPORT!=='reverse_pull'||
  !cloudRun.test(origin)||source.PHONE11_LAB_SIP_RUNNER_SERVICE_ACCOUNT!==runnerAccount)throw new ReversePullRunnerError();
 return {origin,runnerAccount,executionId:driver.executionId,expiresAt:driver.expiresAt,secret:driver.secret,driver};
}

export function createIdentityTokenProvider(config,{execute=execFileSync,now=Date.now}={}){
 let cached='',expiresAt=0;
 return async()=>{if(cached&&expiresAt>now()+60_000)return cached;
  let token;try{token=execute('gcloud',['auth','print-identity-token',`--impersonate-service-account=${config.runnerAccount}`,`--audiences=${config.origin}`],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30_000}).trim();}catch{throw new ReversePullRunnerError();}
  const parts=token.split('.');if(parts.length!==3)throw new ReversePullRunnerError();
  try{const payload=JSON.parse(Buffer.from(parts[1].replace(/-/g,'+').replace(/_/g,'/'),'base64url').toString('utf8'));expiresAt=Number(payload.exp)*1000;}catch{throw new ReversePullRunnerError();}
  if(!Number.isSafeInteger(expiresAt)||expiresAt<=now()+60_000)throw new ReversePullRunnerError();cached=token;return token;};
}

function lease(value,config,now){
 if(!exactKeys(value,value?.operation==='start'?['v','leaseId','operation','executionId','testId','correlationId','targetSipUri','leaseExpiresAt']:['v','leaseId','operation','executionId','testId','correlationId','leaseExpiresAt'])||
  value.v!==1||!['start','evidence'].includes(value.operation)||!uuid.test(value.leaseId)||!uuid.test(value.correlationId)||value.executionId!==config.executionId||!config.driver.cases.has(value.testId)||
  !Number.isSafeInteger(value.leaseExpiresAt)||value.leaseExpiresAt<=now()||value.leaseExpiresAt>config.expiresAt||value.operation==='start'&&value.targetSipUri!==config.driver.targetSipUri)throw new ReversePullRunnerError();
 return structuredClone(value);
}

export function createReversePullRunner({source=()=>process.env,now=Date.now,wait=sleep,fetchImpl=fetch,driverService,tokenProvider}={}){
 const config=readReversePullRunnerConfig(source(),now()),service=driverService??createRealSipDriverService({source,now}),token=tokenProvider??createIdentityTokenProvider(config,{now});
 const headers=async(json=false)=>({authorization:`Bearer ${await token()}`,'x-phone11-lab-driver-secret':config.secret,'x-phone11-execution-id':config.executionId,...(json?{'content-type':'application/json'}:{})});
 const request={executionId:config.executionId};
 return {
  async pollOnce(){
   let response;try{response=await fetchImpl(`${config.origin}/api/phone11/lab/sip-driver/lease`,{method:'GET',headers:await headers(),redirect:'error'});}catch{throw new ReversePullRunnerError();}
   if(response.status===204)return {status:'idle'};if(response.status!==200)throw new ReversePullRunnerError();
   let item;try{item=lease(await response.json(),config,now);}catch{throw new ReversePullRunnerError();}
   const localHeaders={'x-phone11-lab-driver-secret':config.secret,'x-phone11-execution-id':config.executionId};
   const input={...request,testId:item.testId,correlationId:item.correlationId};
   const result=item.operation==='start'?await service.start(localHeaders,{...input,targetSipUri:item.targetSipUri}):await service.evidence(localHeaders,input);
   const body={v:1,leaseId:item.leaseId,operation:item.operation,...input,result};
   let completed;try{completed=await fetchImpl(`${config.origin}/api/phone11/lab/sip-driver/complete`,{method:'POST',headers:await headers(true),redirect:'error',body:JSON.stringify(body)});}catch{throw new ReversePullRunnerError();}
   if(completed.status!==202)throw new ReversePullRunnerError();return {status:'completed',operation:item.operation};
  },
  async run(){let completed=0;while(now()<config.expiresAt){const result=await this.pollOnce();if(result.status==='completed')completed++;await wait(result.status==='idle'?250:25);}return {status:'expired',completed};},
 };
}

if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
 try{const result=await createReversePullRunner().run();console.log(JSON.stringify(result));}catch{console.error('Private reverse-pull runner stopped; no further SIP action was attempted.');process.exitCode=1;}
}
