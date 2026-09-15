import { createHash } from 'node:crypto';
import fs from 'node:fs';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const matrix=JSON.parse(fs.readFileSync(new URL('./matrix.json',import.meta.url),'utf8'));
export function explicitEmulator(serial, devices) {
 if(!/^emulator-\d+$/.test(serial||''))throw new Error('Set LAB_EMULATOR_SERIAL to the dedicated emulator; physical devices are forbidden');
 if(!devices.split('\n').some(l=>l.startsWith(serial+'\tdevice')))throw new Error('Selected emulator is not online');
 return serial;
}
export function safeDestination(value){if(!['7101','7102','7190','7191'].includes(value))throw new Error('Destination denied');return value;}
export function safeAttempt(n){if(!Number.isInteger(n)||n<1||n>3)throw new Error('At most two diagnostic reruns');return n;}
export function sanitize(value,secrets=[]) {
 let s=JSON.stringify(value);
 for(const secret of secrets.filter(s=>typeof s==='string'&&s.length>0))s=s.split(secret).join('[REDACTED]');
 s=s.replace(/(?:Bearer|Wake)\s+[A-Za-z0-9_.-]+/gi,'[REDACTED AUTH]');
 return JSON.parse(s, (k,v)=>/password|authorization|token|sessionBinding|grant|credential|destinationIdentifier/i.test(k)?'[REDACTED]':v);
}
export function aggregate(attempts){
 const rows=matrix.map(test=>{
  const all=attempts.filter(a=>a.test_id===test.id);
  const last=all.at(-1);
  // A later diagnostic pass must not erase an original failing attempt.
  const result=all.some(a=>a.result==='FAIL')?'FAIL':last?.result??'NOT_RUN';
  return {...test,result,attempts:all};
 });
 const counts={};for(const r of rows){counts[r.level]??={};counts[r.level][r.result]=(counts[r.level][r.result]||0)+1;}
 return {status:rows.filter(r=>r.required).every(r=>r.result==='PASS')?'PASS':'PARTIAL',counts,rows};
}
export function validateAttempt(a){
 const spec=matrix.find(s=>s.id===a.test_id);if(!spec)throw new Error('Unknown matrix ID');safeAttempt(a.attempt);
 if(a.evidence_level!==spec.level)throw new Error('Wrong evidence level');
 if(!['PASS','FAIL','BLOCKED','NOT_RUN','NOT_APPLICABLE'].includes(a.result))throw new Error('Invalid result');
 if(spec.level!=='L0'&&a.mode==='fake'&&a.result==='PASS')throw new Error('Fake cannot pass native/runtime gates');
 if(a.result==='PASS'&&(!a.artifacts?.length||!a.assertions?.length))throw new Error('PASS requires evidence and assertions');
 if(a.result!=='PASS'&&!a.reason)throw new Error('Missing reason');return a;
}
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderReport(data){return `<!doctype html><meta charset="utf-8"><title>Phone11 Android lab evidence</title><style>body{font:16px system-ui;margin:40px;background:#0d0f14;color:#e9eef8}table{border-collapse:collapse;width:100%}td,th{padding:12px;border-bottom:1px solid #303640;text-align:left}small{color:#b1bbcb}a{color:#64c2ff}</style><h1>Phone11 Android lab — ${escape(data.status)}</h1><p>Matrix coverage is separate from unit-test counts. Emulator evidence does not establish physical handset readiness.</p><pre>${escape(JSON.stringify(data.counts,null,2))}</pre><table><tr><th>ID / level</th><th>Scenario</th><th>Result</th><th>Evidence / gap</th></tr>${data.rows.map(r=>`<tr><td>${r.id} / ${r.level}</td><td>${escape(r.scenario)}</td><td>${r.result}</td><td>${r.attempts.map(a=>`Attempt ${a.attempt}: ${a.result} ${escape(a.reason||'')} ${a.artifacts.map(f=>`<a href="${escape(f)}">${escape(f)}</a>`).join(' ')}`).join('<br>')||'Not executed'}</td></tr>`).join('')}</table>`;}
export function junit(data){return `<testsuite name="Phone11 Android acceptance" tests="${data.rows.length}" failures="${data.rows.filter(r=>r.result==='FAIL').length}" skipped="${data.rows.filter(r=>!['FAIL','PASS'].includes(r.result)).length}">${data.rows.map(r=>`<testcase name="${r.id}" classname="${r.level}">${r.result==='FAIL'?'<failure message="See JSON for preserved attempts"/>':r.result==='PASS'?'':`<skipped message="${r.result}"/>`}</testcase>`).join('')}</testsuite>`;}
