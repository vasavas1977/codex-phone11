#!/usr/bin/env node
// Parser proof only: a disposable network-disabled container and synthetic values.
import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const args=process.argv.slice(2), image=args[args.indexOf('--image')+1];
if (!args.includes('--image') || !/^[-\w./:]+@sha256:[a-f0-9]{64}$/.test(image??'')) {
  throw new Error('Pass --image registry/repository@sha256:<reviewed digest>; mutable tags are not parser evidence');
}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const candidate=join(root,'infra/configs/kamailio/phone11-wake-candidate');
const scratch=await mkdtemp(join(tmpdir(),'phone11-wake-parser-'));
// Synthetic fixture only: the non-root image UID must traverse the mounted
// directory on Linux runners (mkdtemp otherwise creates owner-only mode0700).
await chmod(scratch,0o755);
const common=['--rm','--network','none','--read-only','--tmpfs','/var/run/kamailio:rw,nosuid,noexec,size=1m,mode=1777','--cap-drop','ALL','--platform','linux/amd64','--entrypoint','/usr/sbin/kamailio'];
function run(extra) {
  const result=spawnSync('docker',['run',...common,...extra],{encoding:'utf8',timeout:45000,maxBuffer:2*1024*1024});
  if(result.error || result.status!==0) throw new Error(`Disposable Kamailio parser failed: ${result.error?.message??''}\n${result.stdout??''}\n${result.stderr??''}`);
  return `${result.stdout??''}\n${result.stderr??''}`;
}
try {
  const version=run([image,'-V']);
  if(!/kamailio 5\.8\.4\b/.test(version)) throw new Error('Image must provide the observed server version Kamailio 5.8.4');
  process.stdout.write(`Verified Kamailio 5.8.4 from ${image}\n`);
  for(const enabled of [false,true]) {
    const config=`#!KAMAILIO
${enabled?'#!define WITH_PHONE11_WAKE_CANDIDATE':''}
#!define PHONE11_WAKE_PILOT_URI "sip:1001@test.invalid"
#!define PHONE11_WAKE_API "http://127.0.0.1:9/api/phone11/wake"
#!define PHONE11_WAKE_SECRET "synthetic-parser-only-not-a-real-secret"
#!define PHONE11_WAKE_FLAG 30
listen=udp:127.0.0.1:15060
loadmodule "tm.so"
loadmodule "tmx.so"
loadmodule "sl.so"
loadmodule "rr.so"
loadmodule "pv.so"
loadmodule "textops.so"
loadmodule "siputils.so"
loadmodule "usrloc.so"
loadmodule "registrar.so"
loadmodule "jansson.so"
loadmodule "dialog.so"
loadmodule "rtpengine.so"
# Parser-only endpoint; the disposable container has no network access.
modparam("rtpengine", "rtpengine_sock", "udp:127.0.0.1:22222")
include_file "/candidate/modules.inc"
request_route {
#!ifdef WITH_PHONE11_WAKE_CANDIDATE
 if (is_method("CANCEL")) {
   if (t_lookup_cancel("1") && isflagset(PHONE11_WAKE_FLAG)) { route(PHONE11_WAKE_CANCEL); }
   exit;
 }
 if (has_totag() && is_known_dlg() && loose_route() && is_method("BYE") && $dlg_var(phone11_wake) == "1") {
   route(PHONE11_WAKE_END);
   exit;
 }
 route(PHONE11_WAKE_START);
#!endif
 exit;
}
route[PHONE11_INBOUND_OFFER] { return; }
route[RELAY] { t_relay(); exit; }
include_file "/candidate/routes.inc"
`;
    await writeFile(join(scratch,'parser.cfg'),config,{mode:0o644});
    run(['-v',`${scratch}:/proof:ro`,'-v',`${candidate}:/candidate:ro`,image,'-c','-f','/proof/parser.cfg']);
    process.stdout.write(`Kamailio 5.8.4 synthetic parser: gate ${enabled?'enabled':'disabled'} passed\n`);
  }
} finally {await rm(scratch,{recursive:true,force:true});}
