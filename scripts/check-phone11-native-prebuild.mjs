#!/usr/bin/env node
// Exercise the real Expo template in an isolated copy before requesting signing.
import { mkdtemp, mkdir, copyFile, symlink, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const scratch=await mkdtemp(join(tmpdir(),'phone11-native-prebuild-'));
try {
  const inventory=spawnSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'});
  if(inventory.status!==0)throw new Error('Cannot enumerate the reviewed project source');
  for(const path of inventory.stdout.split('\0').filter(Boolean)) {
    assert.ok(!path.startsWith('/')&&!path.split('/').includes('..'));
    const destination=join(scratch,path);await mkdir(dirname(destination),{recursive:true});
    await copyFile(join(root,path),destination);
  }
  await symlink(join(root,'node_modules'),join(scratch,'node_modules'),'dir');
  const env={...process.env,CI:'1',EXPO_NO_TELEMETRY:'1',EXPO_PUBLIC_SIP_ENGINE:'siprix',
    PHONE11_BUNDLE_ID:'space.manus.phone11ai.t20260425073427',EXPO_PUBLIC_API_BASE_URL:'https://api.phone11.ai'};
  delete env.PHONE11_SIPRIX_LICENSE;
  const result=spawnSync(process.execPath,[join(root,'node_modules/expo/bin/cli'),'prebuild','--platform','ios','--no-install'],
    {cwd:scratch,env,encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
  if(result.error||result.status!==0)throw new Error(`Native project generation failed\n${result.stdout??''}\n${result.stderr??''}`);
  const paths=await readdir(join(scratch,'ios'),{recursive:true});
  const delegates=paths.filter(path=>path.endsWith('/AppDelegate.swift'));
  assert.equal(delegates.length,1,'Expected one generated Swift app delegate');
  const delegate=await readFile(join(scratch,'ios',delegates[0]),'utf8');
  assert.equal(delegate.match(/Phone11VoipPush\.bootstrap\(\)/g)?.length,1,'Expected exactly one native wake bootstrap');
  assert.ok(delegate.indexOf('Phone11VoipPush.bootstrap()')<delegate.indexOf('let delegate ='),'Native bootstrap must precede the React factory');
  const plist=await readFile(join(scratch,'ios',dirname(delegates[0]),'Info.plist'),'utf8');
  assert.match(plist,/<key>Phone11WakeOrigin<\/key>\s*<string>https:\/\/api\.phone11\.ai<\/string>/);
  console.log('Real Expo iOS prebuild passed; native bootstrap and fixed origin verified. No signing or installation performed.');
} finally {await rm(scratch,{recursive:true,force:true});}
