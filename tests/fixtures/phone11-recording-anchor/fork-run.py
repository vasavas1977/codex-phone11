"""Real SIP/async fork regression with a synthetic NG responder; no audio claim."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import subprocess, threading, time, sys, pathlib, re
class HTTP(BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_GET(self):
  time.sleep(0.02)
  self.send_response(200); self.end_headers(); self.wfile.write(b'{}')
server=ThreadingHTTPServer(('127.0.0.1',18080),HTTP)
threading.Thread(target=server.serve_forever,daemon=True).start()
source=open('/work/tests/fixtures/phone11-recording-anchor/runtime.py').read()
prelude,scenario=source.split('SDP=',1)
prelude=prelude.replace('ng_commands=[]','ng_commands=[]\ndeleted_calls=set()')
prelude=prelude.replace('result={"result":"pong" if command["command"]=="ping" else "ok"}', 'result={"result":"pong" if command["command"]=="ping" else "ok"}\n            if command["command"]=="delete": deleted_calls.add(command["call-id"])\n            if command["command"]=="offer": deleted_calls.discard(command["call-id"])\n            if command["command"]=="answer" and command["call-id"] in deleted_calls: result={"result":"error","error-reason":"Unknown call-id"}')
prelude=prelude.replace('if command["command"] in ["offer","answer"]:', 'if result["result"]=="ok" and command["command"] in ["offer","answer"]:')
prelude=prelude.replace('result["sdp"]=command["sdp"]', 'result["sdp"]=command["sdp"]\n            if result["result"]=="ok" and command["command"]=="answer" and command.get("transport-protocol")=="RTP/AVP": result["sdp"]=re.sub(r"a=crypto:[^\\r]*\\r\\n", "", command["sdp"].replace("RTP/SAVP", "RTP/AVP").replace("c=IN IP4 192.0.2.2", "c=IN IP4 127.0.0.2"))')
exec(prelude,globals())
# Load the actual source cleanup helpers into an otherwise synthetic SIP route.
wake=pathlib.Path('/work/infra/configs/kamailio/phone11-wake-candidate/routes.inc').read_text()
def source_route(name):
 start=wake.index('route['+name+'] {')
 depth=0
 for end in range(wake.index('{',start),len(wake)):
  if wake[end]=='{': depth+=1
  elif wake[end]=='}':
   depth-=1
   if depth==0:return wake[start:end+1]
 raise AssertionError(name)
baseline='--baseline' in sys.argv
cfg=pathlib.Path('/work/tests/fixtures/phone11-recording-anchor/async-runtime.cfg').read_text()
cfg=cfg.replace('#!define WITH_PHONE11_RECORDING_ANCHOR', '#!define WITH_PHONE11_RECORDING_ANCHOR\n#!define PHONE11_WAKE_FLAG 30').replace(' if (!t_newtran())', ' setflag(PHONE11_WAKE_FLAG);\n if (!t_newtran())')
cfg=cfg.replace('children=4', 'children=4\ndebug=2')
cfg=cfg.replace('loadmodule "tmx.so"','loadmodule "tmx.so"\nloadmodule "corex.so"\nloadmodule "xlog.so"')
cfg=cfg.replace(' $du="sip:3001@127.0.0.1:6001";',' $du="sip:3001@127.0.0.1:6001";\n if (is_present_hf("X-Fixture-Fork")) { $du=$null; append_branch("sip:3001@127.0.0.1:6002"); $du="sip:3001@127.0.0.1:6001"; }\n $avp(phone11_wake_media_allocated)=1;\n t_on_failure("FIXTURE_WAKE_FAILURE");')
cleanup='rtpengine_delete();' if baseline else 'route(PHONE11_WAKE_REPLY_MEDIA_CLEANUP);'
cfg=cfg.replace('onreply_route[PHONE11_INBOUND_REPLY] {','onreply_route[PHONE11_INBOUND_REPLY] {\n if (t_check_status("[3-6][0-9][0-9]")) { '+cleanup+' xlog("L_NOTICE", "FIXTURE_REJECTION_DONE $ci $rs\\n"); }')
cfg+='\n'+source_route('PHONE11_WAKE_REPLY_MEDIA_CLEANUP')+'\n'+source_route('PHONE11_WAKE_MEDIA_CLEANUP')+'\nfailure_route[FIXTURE_WAKE_FAILURE] { route(PHONE11_WAKE_MEDIA_CLEANUP); }\n'
pathlib.Path('/tmp/phone11-fork-runtime.cfg').write_text(cfg)
def await_rejection(callid,status):
 deadline=time.monotonic()+2
 marker=f'FIXTURE_REJECTION_DONE {callid} {status}'
 while marker not in pathlib.Path('/tmp/async-kamailio.log').read_text():
  assert time.monotonic()<deadline, f'Named reply callback not observed: {marker}'
  time.sleep(0.01)
with open('/tmp/async-kamailio.log','w+') as log:
 p=subprocess.Popen(['kamailio','-DD','-E','-f','/tmp/phone11-fork-runtime.cfg'],stdout=log,stderr=log)
 try:
  time.sleep(6)
  if p.poll() is not None: raise RuntimeError('Kamailio stopped')
  exec('SDP='+scenario,globals())
  stale=sock('127.0.0.1',6002)
  forkid=invite(fs,'3001','returned-v1',['X-Fixture-Fork: yes'])
  current_packet=receive(device,'Call-ID: '+forkid)
  stale_packet=receive(stale,'Call-ID: '+forkid)
  reply='SIP/2.0 486 Busy Here\r\n'
  for key in ['Via','From','To','Call-ID','CSeq']:
   for value in values(stale_packet,key):reply+=key+': '+value+(';tag=stale-phone' if key=='To' else '')+'\r\n'
  reply+='Content-Length: 0\r\n\r\n'
  stale.sendto(reply.encode(),('127.0.0.1',5060))
  await_rejection(forkid,486)
  deleted=commands(forkid,'delete')
  assert bool(deleted)==baseline, deleted
  if baseline: assert 'to-tag' not in deleted[0],deleted
  answer(current_packet,device,SECURE_SDP,'active-phone')
  received=receive(fs,'Call-ID: '+forkid)
  while '200 OK' not in received: received=receive(fs,'Call-ID: '+forkid)
  if baseline:
   assert SECURE_SDP in received, received
   print('PASS NEGATIVE: stale fork 486 deletes call media; next 200 forwards raw SAVP despite named-route drop after NG Unknown call-id')
  else:
   assert not commands(forkid,'delete'), 'live fork media was deleted'
   assert commands(forkid,'answer')[0]['transport-protocol']=='RTP/AVP'
   assert 'RTP/AVP' in received and 'RTP/SAVP' not in received and 'a=crypto:' not in received and 'c=IN IP4 127.0.0.2' in received, received
   print('PASS: failed contact preserves shared media; FS receives the NG responder rewritten RTP/AVP answer')
  assert commands(forkid,'answer'),'successful branch should attempt answer after stale delete'
  if not baseline:
   winnerid=invite(fs,'3001','returned-v1',['X-Fixture-Fork: yes'])
   winner=receive(device,'Call-ID: '+winnerid)
   loser=receive(stale,'Call-ID: '+winnerid)
   answer(winner,device,SECURE_SDP,'winner-first')
   accepted=receive(fs,'Call-ID: '+winnerid)
   while '200 OK' not in accepted: accepted=receive(fs,'Call-ID: '+winnerid)
   reply='SIP/2.0 487 Request Terminated\r\n'
   for key in ['Via','From','To','Call-ID','CSeq']:
    for value in values(loser,key):reply+=key+': '+value+(';tag=loser-late' if key=='To' else '')+'\r\n'
   reply+='Content-Length: 0\r\n\r\n'
   stale.sendto(reply.encode(),('127.0.0.1',5060))
   await_rejection(winnerid,487)
   assert not commands(winnerid,'delete'),commands(winnerid,'delete')
   assert 'RTP/AVP' in accepted and 'a=crypto:' not in accepted,accepted
   print('PASS: a late losing-branch 487 preserves the already accepted call media')
  # Both contacts failing must still release the shared allocation once.
  failedid=invite(fs,'3001','returned-v1',['X-Fixture-Fork: yes'])
  first=receive(device,'Call-ID: '+failedid)
  second=receive(stale,'Call-ID: '+failedid)
  for packet,endpoint in [(first,device),(second,stale)]:
   reply='SIP/2.0 486 Busy Here\r\n'
   for key in ['Via','From','To','Call-ID','CSeq']:
    for value in values(packet,key):reply+=key+': '+value+(';tag=failed-'+str(endpoint.getsockname()[1]) if key=='To' else '')+'\r\n'
   reply+='Content-Length: 0\r\n\r\n'
   endpoint.sendto(reply.encode(),('127.0.0.1',5060))
  failed_response=receive(fs,'Call-ID: '+failedid)
  while '486 Busy Here' not in failed_response: failed_response=receive(fs,'Call-ID: '+failedid)
  time.sleep(0.1)
  if not baseline:
   assert len(commands(failedid,'delete'))==1,commands(failedid,'delete')
   print('PASS: all branches failing releases the shared media allocation exactly once')
 finally:
  p.terminate();p.wait(timeout=5)
  if sys.exc_info()[0] is not None:
   log.seek(0);print(log.read()[-20000:])
