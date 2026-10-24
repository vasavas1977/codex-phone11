import base64,hashlib,importlib.util,json,os,socket,sys,tempfile,threading,time,unittest,urllib.parse
from pathlib import Path
D=Path(__file__).resolve().parent;s=importlib.util.spec_from_file_location('transport',D/'transport.py');t=importlib.util.module_from_spec(s);s.loader.exec_module(t)
BODY=b'cdr=%3Ccdr%3E%3Cvariables%3E%3C%2Fvariables%3E%3C%2Fcdr%3E';ACK=b'{"ok":true,"callRecordId":1,"callLegId":2}';SECRET='owned-test-secret-'+('s'*32)
def response(status=200,body=ACK,headers=b''):
 return b'HTTP/1.1 '+str(status).encode()+b' Test\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: '+str(len(body)).encode()+b'\r\nConnection: close\r\n'+headers+b'\r\n'+body
class Fixture:
 def __init__(self,payload,drip=False):
  self.payload=payload;self.drip=drip;self.request=None;self.attempts=0;self.listener=socket.socket();self.listener.bind(('127.0.0.1',0));self.listener.listen(1);self.port=self.listener.getsockname()[1];self.peer=None;self.error=None;self.stop=threading.Event();self.thread=threading.Thread(target=self.run,daemon=True)
 def __enter__(self):self.thread.start();return self
 def __exit__(self,*args):
  self.stop.set();self.listener.close()
  if self.peer is not None:
   try:self.peer.shutdown(socket.SHUT_RDWR)
   except OSError:pass
   self.peer.close()
  self.thread.join(1);assert not self.thread.is_alive()
 def run(self):
  try:
   self.listener.settimeout(.5);self.peer,_=self.listener.accept();self.peer.settimeout(1);self.attempts+=1;raw=bytearray();end=None;length=None
   while end is None or len(raw)-end<length:
    part=self.peer.recv(65536)
    if not part:return
    raw.extend(part)
    if end is None and b'\r\n\r\n'in raw:
     begin=raw.index(b'\r\n\r\n');end=begin+4;length=int(next(x.split(b':',1)[1]for x in raw[:begin].split(b'\r\n')if x.lower().startswith(b'content-length:')))
   self.request=bytes(raw)
   if self.drip:
    for byte in self.payload:
     if self.stop.wait(.025):break
     self.peer.sendall(bytes([byte]))
   else:self.peer.sendall(self.payload)
  except OSError:pass
  finally:
   if self.peer is not None:
    try:self.peer.shutdown(socket.SHUT_WR)
    except OSError:pass
 def socket_factory(self,*args):
  raw=socket.socket(*args);owner=self
  class OwnedSocket:
   def connect(self,address):
    assert address==t.ADDRESS;return raw.connect(('127.0.0.1',owner.port))
   def __getattr__(self,key):return getattr(raw,key)
  return OwnedSocket()
class Tests(unittest.TestCase):
 def test_actual_basic_form_path_and_two_runtime_checks_no_encoding_change(self):
  checks=[]
  with Fixture(response())as f:
   transport=t.Transport(SECRET,lambda source,end:(checks.append((source,end))or True),socket_factory=f.socket_factory);self.assertEqual(transport(BODY,1),(200,ACK));self.assertEqual(f.attempts,1);head,body=f.request.split(b'\r\n\r\n',1);self.assertEqual(body,BODY);self.assertTrue(head.startswith(b'POST /api/freeswitch/cdr HTTP/1.1'));self.assertIn(b'Host: 127.0.0.1:3030',head);self.assertIn(b'Authorization: Basic '+base64.b64encode(('phone11-cdr:'+SECRET).encode()),head);self.assertEqual(len(checks),2);self.assertEqual(checks[0][0],t.SOURCE_SHA);self.assertEqual(checks[0][1],checks[1][1])
 def test_500_and_503_return_once_for_worker_owned_backoff(self):
  for status in(500,503):
   with Fixture(response(status,b'{"error":"owned fixture"}'))as f:self.assertEqual(t.Transport(SECRET,lambda *_:True,socket_factory=f.socket_factory)(BODY,1)[0],status);self.assertEqual(f.attempts,1)
 def test_redirect_never_followed(self):
  with Fixture(response(302,b'{}',b'Location: http://127.0.0.1:9/forbidden\r\n'))as f:self.assertEqual(t.Transport(SECRET,lambda *_:True,socket_factory=f.socket_factory)(BODY,1)[0],302);self.assertEqual(f.attempts,1)
 def test_monotonic_total_deadline_rejects_slow_drip(self):
  with Fixture(response(),drip=True)as f:
   start=time.monotonic()
   with self.assertRaises(t.Refused):t.Transport(SECRET,lambda *_:True,socket_factory=f.socket_factory)(BODY,.12)
   self.assertLess(time.monotonic()-start,.35);self.assertEqual(f.attempts,1)
 def test_truncated_duplicate_chunked_oversized_and_nonjson_refuse(self):
  bad=[response()[:-2],response(headers=b'Content-Length: '+str(len(ACK)).encode()+b'\r\n'),response(headers=b'Transfer-Encoding: chunked\r\n'),response(body=b'x'*1025),response().replace(b'application/json',b'text/html'),response()+b'EXTRA',b'HTTP/1.1 200 OK\r\nX: '+b'x'*8193]
  for raw in bad:
   with self.subTest(kind=raw[:25]),Fixture(raw)as f,self.assertRaises(t.Refused):t.Transport(SECRET,lambda *_:True,socket_factory=f.socket_factory)(BODY,1)
 def test_runtime_false_before_http_never_connects(self):
  calls=[]
  with self.assertRaisesRegex(t.Refused,'RUNTIME_ATTESTATION_UNPROVEN'):t.Transport(SECRET,lambda *_:False,socket_factory=lambda *_:calls.append(True))(BODY,1)
  self.assertEqual(calls,[])
 def test_runtime_drift_after_http_returns_unknown_not_ack(self):
  n=[0]
  def attest(*_):n[0]+=1;return n[0]==1
  with Fixture(response())as f,self.assertRaisesRegex(t.Refused,'RUNTIME_ATTESTATION_UNPROVEN'):t.Transport(SECRET,attest,socket_factory=f.socket_factory)(BODY,1)
 def test_bad_body_timeout_and_private_exception_never_expose_secret(self):
  for body in(b'<cdr/>',b'cdr=cdr=x',b'cdr=%ZZ',b'cdr=x&other=y'):
   with self.assertRaises(t.Refused):t.Transport(SECRET,lambda *_:True)(body,1)
  for timeout in(0,6,True):
   with self.assertRaises(t.Refused):t.Transport(SECRET,lambda *_:True)(BODY,timeout)
  def fail(*_):raise RuntimeError(SECRET)
  with self.assertRaises(t.Refused)as caught:t.Transport(SECRET,fail)(BODY,1)
  self.assertNotIn(SECRET,str(caught.exception));self.assertIsNone(caught.exception.__cause__)
 def integrated(self,reply,expected):
  path=D/'replay_worker.py';self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),'25cd6f8eba2d22b24e03a6c18cb5e5829cd46981a350f4ac233d269406391437');spec=importlib.util.spec_from_file_location('retained_replay_worker',path);r=importlib.util.module_from_spec(spec);sys.modules[spec.name]=r;spec.loader.exec_module(r)
  with tempfile.TemporaryDirectory()as temp,Fixture(reply)as f:
   root=Path(temp).resolve();spool=root/'spool';state=root/'state';spool.mkdir(mode=0o700);state.mkdir(mode=0o700);uuid='5f38611e-b4f7-4234-b2bf-6335804e9a73';xml='<cdr><variables><uuid>'+uuid+'</uuid><tenant_id>1</tenant_id><start_epoch>1</start_epoch><answer_epoch>2</answer_epoch><end_epoch>3</end_epoch></variables></cdr>';payload=urllib.parse.quote(xml,safe='').encode();original=spool/(uuid+'.cdr.xml');original.write_bytes(payload);original.chmod(0o644);before=r.frame(original.stat());calls=[];transport=t.Transport(SECRET,lambda *_:True,socket_factory=f.socket_factory)
   def one(body,timeout):calls.append(True);return transport(body,timeout)
   # These wholly owned fixtures were synchronously written+closed above;
   # True providers are test authority only, never production closure evidence.
   worker=r.Worker(str(spool),str(state),one,lambda _:True,lambda *_:True,uid=os.getuid(),limits=r.Limits(settle_seconds=0));summary=worker.run();journal=json.loads(next(x for x in state.glob('*.json')if x.name!='scan-cursor.json').read_bytes());self.assertEqual(journal['status'],expected);self.assertEqual(original.read_bytes(),payload);self.assertEqual(r.frame(original.stat()),before);self.assertEqual(next(state.glob('*.body')).read_bytes(),payload);self.assertEqual(f.attempts,1);self.assertEqual(f.request.split(b'\r\n\r\n',1)[1],b'cdr='+payload)
   again=worker.run();self.assertEqual(len(calls),1)
   if expected=='ACK':self.assertEqual(summary['acknowledged'],1);self.assertEqual(again['skippedAcknowledged'],1)
   else:self.assertEqual(summary['retained'],1);self.assertEqual(again['blockedJournal'],1)
 def test_existing_worker_ack_preserves_original_snapshot_and_skips_duplicate(self):self.integrated(response(),'ACK')
 def test_existing_worker_disconnect_after_post_is_unknown_retained_and_blocked(self):self.integrated(b'','UNKNOWN')
if __name__=='__main__':unittest.main(verbosity=2)
