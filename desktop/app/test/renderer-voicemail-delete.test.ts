import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
const root=join(__dirname,'..');const tick=()=>new Promise<void>(r=>setImmediate(r));
type Stub = {hidden:boolean;disabled:boolean;textContent:string;value:string;dataset:Record<string,string>;className:string;src:string;paused:boolean;
 children:Stub[];listeners:Map<string,(event:unknown)=>unknown>;addEventListener(type:string,fn:(event:unknown)=>unknown):void;removeEventListener():void;
 append(...children:Stub[]):void;replaceChildren():void;setAttribute():void;removeAttribute(name:string):void;focus():void;pause():void;load():void;play():Promise<void>};
function element(): Stub {return {hidden:false,disabled:false,textContent:'',value:'',dataset:{},className:'',src:'',paused:true,children:[] as Stub[],listeners:new Map<string,(event:unknown)=>unknown>(),addEventListener(type:string,fn:(event:unknown)=>unknown){this.listeners.set(type,fn);},removeEventListener(){},append(...children:Stub[]){this.children.push(...children);},replaceChildren(){this.children=[];},setAttribute(){},removeAttribute(name:string){if(name==='src')this.src='';},focus(){},pause(){this.paused=true;},load(){},play(){this.paused=false;return Promise.resolve();}};}
async function fixture() {
 const bundle=await build({entryPoints:[join(root,'src/renderer.ts')],bundle:true,write:false,platform:'browser',format:'iife',plugins:[{name:'synthetic-only-inbox',setup(b){b.onLoad({filter:/[/\\]ipc\.ts$/},a=>({contents:readFileSync(a.path,'utf8').replace('VOICEMAIL_ENABLED = false','VOICEMAIL_ENABLED = true'),loader:'ts'}));}}]});
 const ids=[...readFileSync(join(root,'src/index.html'),'utf8').matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);const elements=new Map(ids.map(id=>[id,element()]));
 const idle={registered:true,call:null,dialState:'idle',callActionState:'idle',holdMessage:null};let state={signedIn:true,sessionRevision:'r1',generation:'g1',tenantId:9,calling:idle};const item={id:4,callerName:'Owned',callerNumber:null,status:'new',durationSeconds:1,createdAt:'2026-10-09T00:00:00Z'};
 const deletes:{resolve:(value:unknown)=>void;reject:(error:Error)=>void}[]=[];const audio:{resolve:(value:unknown)=>void}[]=[];let urls=0;const get=(id:string)=>elements.get(id)!;
 runInNewContext(bundle.outputFiles[0].text,{Uint8Array,Blob,URL:{createObjectURL:()=>{urls++;return 'blob:synthetic';},revokeObjectURL:()=>{}},setTimeout,clearTimeout,document:{getElementById:(id:string)=>elements.get(id),createElement:element},window:{addEventListener(){},phone11:{state:async()=>state,onUpdate:()=>{},signOut:async()=>({...state,signedIn:false,sessionRevision:null}),signIn:async()=>state,historyList:async(r:string)=>({sessionRevision:r,items:[],nextCursor:null}),voicemailList:async(r:string)=>({sessionRevision:r,items:[item]}),voicemailDelete:()=>new Promise((resolve,reject)=>{deletes.push({resolve,reject});}),voicemailAudio:()=>new Promise(resolve=>{audio.push({resolve});}),voicemailMarkRead:async()=>{}}}});
 await tick();const event=(id:string,type='click')=>get(id).listeners.get(type)!({preventDefault(){}});event('voicemail-tab');await tick();const rows=()=>get('voicemail-list').children;const button=(i:number)=>rows()[0].children[i];const click=(v:Stub)=>v.listeners.get('click')!({});
 return {event,rows,button,click,deletes,audio,urls:()=>urls,async replace(){await event('sign-out');state={...state,sessionRevision:'r2',tenantId:12};await event('login-form','submit');event('voicemail-tab');await tick();}};
}
test('actual renderer pending/retry/Cancel, success filtering through refresh and late audio retirement',async()=>{
 const f=await fixture();assert.equal(f.rows().length,1);f.click(f.button(2));await tick();assert.equal(f.audio.length,1);f.click(f.button(3));assert.equal(f.deletes.length,1);assert.equal(f.button(3).textContent,'Deleting…');assert.equal(f.button(2).disabled,true);
 f.audio[0].resolve({sessionRevision:'r1',id:4,mimeType:'audio/wav',bytes:new Uint8Array([1])});await tick();assert.equal(f.urls(),0);
 f.deletes[0].resolve({sessionRevision:'r1',id:4,deleted:false});await tick();assert.equal(f.rows().length,1);assert.equal(f.button(3).textContent,'Delete');f.click(f.button(3));f.deletes[1].reject(new Error('PRIVATE'));await tick();assert.equal(f.button(3).textContent,'Retry delete');assert.match(f.rows()[0].children[4].textContent,/could not be confirmed/);
 f.click(f.button(3));f.deletes[2].resolve({sessionRevision:'r1',id:4,deleted:true});await tick();assert.equal(f.rows().some(r=>r.className==='voicemail-item'),false);f.event('voicemail-refresh');await tick();assert.equal(f.rows().some(r=>r.className==='voicemail-item'),false);
});
test('retired renderer row and late delete cannot remove replacement-account same ID',async()=>{const f=await fixture();const oldButton=f.button(3);f.click(oldButton);await f.replace();f.deletes[0].resolve({sessionRevision:'r1',id:4,deleted:true});await tick();assert.equal(f.rows().length,1);f.click(oldButton);assert.equal(f.deletes.length,1);});
