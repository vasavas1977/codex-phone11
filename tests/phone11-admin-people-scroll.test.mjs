import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {access,mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import test from 'node:test';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let browser;
for(const candidate of [process.env.PHONE11_HYDRATION_BROWSER,'/usr/bin/google-chrome','/usr/bin/chromium','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean)){
 try{await access(candidate);browser=candidate;break}catch{/* No install or existing profile. */}
}
const fixture=`
export const user={id:7,openId:'synthetic-owner',name:'Synthetic owner',email:'owner@example.invalid',loginMethod:'email',lastSignedIn:new Date('2026-10-15T00:00:00Z')};
export const members=Array.from({length:8},(_,i)=>({id:7+i,name:i?'Synthetic '+(1020+i):'Synthetic owner',email:'person'+i+'@example.invalid',role:i===0?'owner':i===1?'admin':'user',status:i===7?'inactive':'active',assigned_extension_numbers:[String(1020+i)]}));
export const query={isSuccess:true,isLoading:false,isError:false,isFetching:false,refetch:async()=>{}};
export const tenant={...query,data:{id:18,name:'Synthetic workspace',userRole:'owner'}};
export const workspace={selectedTenantId:18,manageableMemberships:[{tenantId:18,role:'owner'}],membershipsQuery:query,canUseImplicitTenant:true,admissionChecking:false,admissionError:false,updateRequired:false};
export const state={user,loading:false,error:null};
export const invitations=Array.from({length:2},(_,i)=>({id:'synthetic-'+i,email:'invitee'+i+'@example.invalid',role:'user',status:'pending',expiresAt:'2026-11-01T00:00:00Z',createdAt:'2026-10-15T00:00:00Z',deliveryStatus:'pending'}));
export function denied(){window.__mutations++;throw Error('Synthetic mutations denied')}`;
const shims={
 'hooks/use-auth.ts':`import {user} from 'fixture-data';export const useAuth=()=>({user,loading:false});`,
 'hooks/use-pbx-admin.ts':`import {workspace,tenant,members,query,denied} from 'fixture-data';const update={isPending:false,mutateAsync:denied};export const usePbxAdminWorkspace=()=>workspace;export const useTenant=()=>tenant;export const useTenantMembers=()=>({...query,data:members});export const useUpdateTenantMember=()=>update;`,
 'hooks/use-directory.ts':`export const useDirectory=()=>({owner:7,requestedTenant:18,workspace:{id:18},people:[]});`,
 'hooks/use-colors.ts':`import {Colors} from '@/constants/theme';export const useColors=()=>Colors.light;`,
 'lib/_core/auth.ts':`import {state} from 'fixture-data';export const getAuthSnapshot=()=>state;export const addAuthChangeListener=()=>()=>{};export const getSessionToken=async()=>null;`,
 'lib/_core/api.ts':`import {user} from 'fixture-data';export const refreshAuth=async()=>user;`,
 'lib/trpc.ts':`import {invitations,denied} from 'fixture-data';export const createTRPCClient=()=>({invitations:{availability:{query:async()=>({enabled:true})},list:{query:async()=>invitations},create:{mutate:denied},resend:{mutate:denied},revoke:{mutate:denied}}});`,
};
const plugin={name:'synthetic-api-boundaries',setup(builder){
 builder.onResolve({filter:/^fixture-data$/},()=>({path:'fixture',namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:fixture,loader:'js'}));
 builder.onResolve({filter:/^expo-router$/},()=>({path:'router',namespace:'router'}));builder.onLoad({filter:/^router$/,namespace:'router'},()=>({contents:'export const router={push(){},back(){},replace(){}};',loader:'js'}));
 builder.onLoad({filter:/\.(ts|tsx)$/},async args=>{const key=path.relative(root,args.path).replaceAll(path.sep,'/');if(key in shims)return {contents:shims[key],loader:'ts'};return undefined;});
}};
for(const [width,height] of [[700,384],[1280,900]]){
 test(`People invitations and rows share a reachable scroll area at ${width}x${height}`,{skip:!browser&&'Set PHONE11_HYDRATION_BROWSER to an existing Chromium executable.',timeout:30000},async()=>{
  const temporary=await mkdtemp(path.join(os.tmpdir(),'phone11-people-scroll-'));
  try{
   const source=`import React from 'react';import {createRoot} from 'react-dom/client';import {SafeAreaProvider} from 'react-native-safe-area-context';import {AdminShell} from '@/components/admin/admin-shell';import AdminUsers from ${JSON.stringify(path.join(root,'app/admin/users.tsx'))};
window.__mutations=0;const metrics={insets:{top:0,left:0,right:0,bottom:0},frame:{x:0,y:0,width:innerWidth,height:innerHeight}};
createRoot(document.getElementById('root')).render(<SafeAreaProvider initialMetrics={metrics}><AdminShell pathname="/admin/users" workspaceName="Synthetic workspace" workspaces={[{id:18,name:'Synthetic workspace'}]} selectedTenantId={18} canManage canUseImplicitTenant onNavigate={()=>{}} onChooseWorkspace={()=>{}}><AdminUsers/></AdminShell></SafeAreaProvider>);
const wait=ms=>new Promise(done=>setTimeout(done,ms));const button=label=>document.querySelector('[aria-label="'+label+'"]');const check=(value,message)=>{if(!value)throw Error(message)};
(async()=>{await wait(250);const last=button('Manage Synthetic 1027');check(last,'last member exists');let scroll=last.parentElement;while(scroll&&!['auto','scroll'].includes(getComputedStyle(scroll).overflowY))scroll=scroll.parentElement;check(scroll&&scroll.clientHeight>0,'people scroll area must have positive height');
 const invitation=button('Invite people');check(scroll.contains(invitation),'invitations must share the people scroll area');
 const reach=element=>{element.scrollIntoView({block:'center'});const r=element.getBoundingClientRect(),s=scroll.getBoundingClientRect();check(r.top>=Math.max(0,s.top)-1&&r.bottom<=Math.min(innerHeight,s.bottom)+1,'control must scroll fully into view');};
 for(const manage of document.querySelectorAll('[aria-label^="Manage Synthetic "]'))reach(manage);
 reach(invitation);invitation.click();await wait(20);const create=button('Create invitation');check(create,'invitation form opens');reach(create);check(button('Invitation email address'),'invitation email input exists');reach(last);last.click();await wait(20);check(button('Close member editor'),'member editor opens');button('Close member editor').click();await wait(20);let animated=button('Close member editor');while(animated&&getComputedStyle(animated).animationName==='none')animated=animated.parentElement;if(animated)animated.dispatchEvent(new AnimationEvent('animationend',{bubbles:true}));await wait(20);check(!button('Close member editor'),'member editor closes');
 const role=button('Filter by role');reach(role);role.click();await wait(20);const member=Array.from(document.querySelectorAll('[role="button"]')).find(e=>e.textContent==='Member');check(member,'member filter option');member.click();await wait(20);check(document.body.textContent.includes('Showing 6 of 8 people'),'role filter works');
 const status=button('Filter by status');reach(status);status.click();await wait(20);const inactive=Array.from(document.querySelectorAll('[role="button"]')).find(e=>e.textContent==='Inactive');check(inactive,'inactive filter option');inactive.click();await wait(20);check(document.body.textContent.includes('Showing 1 of 8 people'),'status filter works');reach(button('Manage Synthetic 1027'));
 document.getElementById('result').textContent=JSON.stringify({pass:true,scrollHeight:scroll.clientHeight,allRowsReachable:true,invitationFormReachable:true,editorOpenedAndClosed:true,filtersWorking:true,mutations:window.__mutations});})().catch(e=>document.getElementById('result').textContent=JSON.stringify({error:e.message}));`;
   const output=await build({absWorkingDir:root,stdin:{contents:source,resolveDir:root,sourcefile:'people-layout.tsx',loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.js':'jsx','.ttf':'dataurl','.png':'dataurl'},resolveExtensions:['.web.tsx','.web.ts','.web.jsx','.web.js','.tsx','.ts','.jsx','.js','.json'],alias:{'react-native':'react-native-web','@':root},define:{global:'globalThis',__DEV__:'true','process.env.NODE_ENV':'"development"','process.env.EXPO_OS':'"web"'},plugins:[plugin],logLevel:'silent'});
   const file=path.join(temporary,'people.html');await writeFile(file,`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; img-src data:"><style>html,body,#root{height:100%;margin:0;overflow:hidden}#root{display:flex}#result{display:none}</style></head><body><div id="root"></div><pre id="result">PENDING</pre><script>window.process={env:{}};window.addEventListener("error",event=>document.getElementById("result").textContent=JSON.stringify({error:event.message}));${output.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></body></html>`);
   const {stdout}=await promisify(execFile)(browser,['--headless','--no-sandbox','--disable-gpu','--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND',`--window-size=${width},${height}`,`--user-data-dir=${path.join(temporary,'profile')}`,'--dump-dom','--virtual-time-budget=2500',pathToFileURL(file).href],{timeout:20000,maxBuffer:12*1024*1024});
   const match=stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/);assert.ok(match);const result=JSON.parse(match[1].replaceAll('&quot;','"').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&'));assert.equal(result.error,undefined);assert.equal(result.pass,true);assert.equal(result.mutations,0);
  }finally{await rm(temporary,{recursive:true,force:true})}
 });
}
