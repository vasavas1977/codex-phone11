#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const prefix=`phone11-wake-fixture-${randomUUID().slice(0,8)}`;
const image='ghcr.io/kamailio/kamailio-ci@sha256:8eebac744905d360d04bd871ee46a3de0908aa30989649c00fd590914cb35fa0';
const python='python@sha256:9a7765b36773a37061455b332f18e265e7f58f6fea9c419a550d2a8b0e9db834';
function run(args,timeout=45000) {
  const result=spawnSync('docker',args,{encoding:'utf8',timeout,maxBuffer:2*1024*1024});
  if(result.error||result.status!==0) throw new Error(`${result.error?.message??''}\n${result.stdout??''}\n${result.stderr??''}`);
  return result.stdout;
}
try {
  // Keep image download latency outside the bounded SIP scenario timer.
  run(['pull',python],60000);
  run(['network','create','--internal',prefix]);
  run(['run','-d','--name',`${prefix}-proxy`,'--network',prefix,'--network-alias','proxy','--platform','linux/amd64','--read-only','--cap-drop','ALL','--tmpfs','/var/run/kamailio:rw,nosuid,noexec,size=1m,mode=1777',
    '-v',`${root}/tests/fixtures/phone11-wake-kamailio:/proof:ro`,'-v',`${root}/infra/configs/kamailio/phone11-wake-candidate:/candidate:ro`,
    '--entrypoint','/usr/sbin/kamailio',image,'-DD','-E','-f','/proof/runtime.cfg']);
  process.stdout.write(run(['run','--name',`${prefix}-fixture`,'--network',prefix,'--network-alias','fixture','--read-only','--cap-drop','ALL','-v',`${root}/tests/fixtures/phone11-wake-kamailio:/proof:ro`,python,'python','-B','/proof/runtime.py'],95000));
} catch(error) {
  const logs=spawnSync('docker',['logs',`${prefix}-proxy`],{encoding:'utf8',timeout:10000,maxBuffer:2*1024*1024});
  process.stderr.write(`${logs.stdout??''}\n${logs.stderr??''}`);throw error;
} finally {
  for(const name of [`${prefix}-fixture`,`${prefix}-proxy`]) spawnSync('docker',['rm','-f',name],{encoding:'utf8',timeout:15000});
  spawnSync('docker',['network','rm',prefix],{encoding:'utf8',timeout:15000});
}
