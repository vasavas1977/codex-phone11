import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync}from'node:child_process';
import {explicitEmulator}from'./core.mjs';
const adb=path.join(process.env.ANDROID_HOME||path.join(os.homedir(),'Library/Android/sdk'),'platform-tools/adb');
export const serial=explicitEmulator(process.env.LAB_EMULATOR_SERIAL,execFileSync(adb,['devices'],{encoding:'utf8',timeout:10000}));
const avd=execFileSync(adb,['-s',serial,'emu','avd','name'],{encoding:'utf8',timeout:10000});if(avd.split(/\r?\n/)[0].trim()!=='Phone11_Lab_API35')throw new Error('Wrong AVD');
export const shell=(...args)=>execFileSync(adb,['-s',serial,'shell',...args],{encoding:'utf8',timeout:15000});
const unescape=s=>s.replace(/&(quot|apos|lt|gt|amp|#x[0-9a-f]+|#\d+);/gi,(_,entity)=>{
 const named={quot:'"',apos:"'",lt:'<',gt:'>',amp:'&'};
 if(!entity.startsWith('#'))return named[entity.toLowerCase()];
 const code=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10);
 return code<=0x10ffff?String.fromCodePoint(code):'\uFFFD';
});
export function parseNodes(xml){return [...xml.matchAll(/<node\b((?:[^>"']|"[^"]*"|'[^']*')*)\/?\s*>/g)].map(match=>Object.fromEntries([...match[1].matchAll(/([a-zA-Z_][a-zA-Z0-9_:.-]*)\s*=\s*(["'])([\s\S]*?)\2/g)].map(m=>[m[1],unescape(m[3])])));}
let observedNodes=[],observedAt=0;
export function nodes(){shell('uiautomator','dump','/sdcard/phone11-lab-ui.xml');observedNodes=parseNodes(shell('cat','/sdcard/phone11-lab-ui.xml'));observedAt=Date.now();return observedNodes;}
export function state(){const n=nodes().find(n=>n['content-desc']?.startsWith('lab-state:'));if(!n)throw new Error('Lab state is not visible');return JSON.parse(n['content-desc'].slice(10));}
export function tap(label){const match=n=>n['content-desc']===label||n.text===label;const n=(Date.now()-observedAt<3000?observedNodes.find(match):null)||nodes().find(match);if(!n)throw new Error('Control not visible: '+label);const b=n.bounds.match(/\d+/g).map(Number);shell('input','tap',String(Math.floor((b[0]+b[2])/2)),String(Math.floor((b[1]+b[3])/2)));observedNodes=[];observedAt=0;}
export async function waitFor(predicate,timeout=20000){const end=Date.now()+timeout;let latest;while(Date.now()<end){latest=state();if(predicate(latest))return latest;await new Promise(r=>setTimeout(r,250));}throw new Error('Deadline exceeded: '+JSON.stringify(latest));}
export function enterPassword(secret){if(!/^[a-fA-F0-9]{16,128}$/.test(secret))throw new Error('Unexpected synthetic password format');tap('Lab password');execFileSync(adb,['-s',serial,'shell'],{input:`input text ${secret}\ninput keyevent 4\nexit\n`,encoding:'utf8',timeout:10000,stdio:['pipe','pipe','pipe']});}
export function screenshot(file){fs.writeFileSync(file,execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{timeout:15000}));}
export function openLab(){return shell('am','start','-W','-a','android.intent.action.VIEW','-d','phone11://android-lab','ai.phone11.mobile.lab');}
