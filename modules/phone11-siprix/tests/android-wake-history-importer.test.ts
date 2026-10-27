import {it,expect,vi} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const f=vi.hoisted(()=>({data:new Map<string,string>(),write:vi.fn()}));
vi.mock('@react-native-async-storage/async-storage',()=>({default:{getItem:async(key:string)=>f.data.get(key)??null,setItem:async(key:string,value:string)=>{f.write(key,value);f.data.set(key,value);}}}));
vi.mock('../../../lib/_core/auth',()=>({getAuthSnapshot:()=>({user:{id:17}}),addAuthChangeListener:()=>()=>{}}));
import {importCompletedWakeCalls,useCallHistoryStore,historyDuration,isMissedCall} from '../../../lib/sip/call-history';
it('the real javac completed record imports durably through the existing JS importer before native acknowledgment',async()=>{
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=mkdtempSync(path.join(tmpdir(),'phone11-wake-history-import-'));
 try{
  execFileSync('javac',['-Xlint:all','-Werror','-d',out,path.join(root,'android/src/main/java/ai/phone11/siprix/Phone11WakeHistoryState.java'),path.join(root,'tests/android-wake-history.java')],{encoding:'utf8'});
  const row=JSON.parse(execFileSync('java',['-cp',out,'ai.phone11.siprix.AndroidWakeHistoryTest','--fixture'],{encoding:'utf8'}));
  await importCompletedWakeCalls([row],17,()=>true);await importCompletedWakeCalls([row],17,()=>true);
  const saved=JSON.parse(f.data.get('phone11_call_history_v1_user_17')!);
  expect(saved).toHaveLength(1);expect(saved[0]).toMatchObject({...row,nativeCompletion:true});expect(useCallHistoryStore.getState().entries[0]).toMatchObject({id:row.id,endedAt:row.endedAt,number:'+6620303883'});expect(isMissedCall(saved[0])).toBe(false);expect(historyDuration(saved[0])).toBe(0);
  await expect(importCompletedWakeCalls([row],18,()=>true)).rejects.toThrow('Invalid completed calls');expect(f.data.has('phone11_call_history_v1_user_18')).toBe(false);
  await expect(importCompletedWakeCalls([row],17,()=>false)).rejects.toThrow('owner changed');
 }finally{rmSync(out,{recursive:true,force:true});}
});
