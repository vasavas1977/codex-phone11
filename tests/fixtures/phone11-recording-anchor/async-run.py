"""Exercise the real suspended transaction path with multiple reply workers."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import subprocess, threading, time
class HTTP(BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_GET(self):
  time.sleep(0.02)
  self.send_response(200); self.end_headers(); self.wfile.write(b'{}')
server=ThreadingHTTPServer(('127.0.0.1',18080),HTTP)
threading.Thread(target=server.serve_forever,daemon=True).start()
source=open('/work/tests/fixtures/phone11-recording-anchor/runtime.py').read()
prelude,scenario=source.split('SDP=',1)
exec(prelude,globals())
with open('/tmp/async-kamailio.log','w+') as log:
 p=subprocess.Popen(['kamailio','-DD','-E','-f','/work/tests/fixtures/phone11-recording-anchor/async-runtime.cfg'],stdout=log,stderr=log)
 try:
  # Emulated x86_64 startup varies; wait for a real SIP response, not a sleep.
  probe=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
  probe.bind(('127.0.0.1',0));probe.settimeout(0.2)
  port=probe.getsockname()[1]
  request=f'OPTIONS sip:fixture@127.0.0.1 SIP/2.0\r\nVia: SIP/2.0/UDP 127.0.0.1:{port};branch=z9hG4bKready\r\nFrom: <sip:probe@fixture>;tag=ready\r\nTo: <sip:fixture@localhost>\r\nCall-ID: readiness@fixture\r\nCSeq: 1 OPTIONS\r\nMax-Forwards: 70\r\nContent-Length: 0\r\n\r\n'
  deadline=time.monotonic()+20
  while True:
   if p.poll() is not None: raise RuntimeError('Kamailio stopped')
   assert time.monotonic()<deadline,'Kamailio SIP listener did not become ready'
   probe.sendto(request.encode(),('127.0.0.1',5060))
   try:
    if b'404 Existing route unchanged' in probe.recv(65535):break
   except socket.timeout:pass
  probe.close()
  exec('SDP='+scenario,globals())
  for attempt in range(32):
   cid=invite(fs,'3001','returned-v1')
   packet=receive(device,'Call-ID: '+cid)
   answer(packet,device,SECURE_SDP,'async-'+str(attempt))
   response=receive(fs,'Call-ID: '+cid)
   while '200 OK' not in response: response=receive(fs,'Call-ID: '+cid)
   assert 'X-Fixture-Reply-State: origin=freeswitch; leg=origin' in response,response
   result=commands(cid,'answer')
   assert len(result)==1 and result[0]['transport-protocol']=='RTP/AVP',result
  print('PASS: 32 consecutive multi-worker async wake answers retain named callback, dialog origin and transaction AVP')
 finally:
  p.terminate();p.wait(timeout=5)
  log.seek(0);print(log.read()[-20000:])
