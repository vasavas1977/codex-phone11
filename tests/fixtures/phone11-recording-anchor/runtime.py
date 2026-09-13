"""Real Kamailio transactions with synthetic FS/device; no RTP acceptance claim."""
import socket, uuid, re

def sock(ip,port):
 s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.bind((ip,port));s.settimeout(3);return s
carrier=sock('127.0.0.2',6000);fs=sock('127.0.0.1',5080);device=sock('127.0.0.1',6001)
def invite(s,dest,marker=None):
 ip,port=s.getsockname();cid=str(uuid.uuid4())+'@fixture'
 msg=f'INVITE sip:{dest}@127.0.0.1 SIP/2.0\r\nVia: SIP/2.0/UDP {ip}:{port};branch=z9hG4bK{uuid.uuid4().hex}\r\nFrom: <sip:caller@fixture>;tag=test\r\nTo: <sip:{dest}@fixture>\r\nCall-ID: {cid}\r\nCSeq: 1 INVITE\r\nMax-Forwards: 70\r\nContact: <sip:caller@{ip}:{port}>\r\n'
 if marker:msg+=f'X-Phone11-Recording-Anchor: {marker}\r\n'
 msg+='Content-Length: 0\r\n\r\n';s.sendto(msg.encode(),('127.0.0.1',5060));return cid

def receive(s,contains):
 while True:
  msg=s.recv(65535).decode()
  if contains in msg:return msg
# Carrier reaches FS, never the synthetic device directly.
a=invite(carrier,'020303001');msg=receive(fs,'INVITE sip:phone11-recording-3001@');assert f'Call-ID: {a}' in msg;assert 'ingress-v1' in msg
# Complete the anchored A dialog using the real proxy's Record-Route.
def values(packet,key):return re.findall(r'^'+re.escape(key)+r': (.+)\r$',packet,re.M|re.I)
reply='SIP/2.0 200 OK\r\n'
for key in ['Via','From','To','Call-ID','CSeq','Record-Route']:
 for value in values(msg,key):reply+=key+': '+value+(';tag=anchored-fs' if key=='To' else '')+'\r\n'
reply+='Contact: <sip:phone11-recording-3001@127.0.0.1:5080>\r\nContent-Length: 0\r\n\r\n'
fs.sendto(reply.encode(),('127.0.0.1',5060));receive(carrier,'200 OK')
for method,cseq in [('ACK',1),('INVITE',2),('BYE',3)]:
 packet=f'{method} sip:phone11-recording-3001@127.0.0.1:5080 SIP/2.0\r\nVia: SIP/2.0/UDP 127.0.0.2:6000;branch=z9hG4bK{uuid.uuid4().hex}\r\n'
 packet+='From: '+values(msg,'From')[0]+'\r\nTo: '+values(msg,'To')[0]+';tag=anchored-fs\r\n'
 packet+=f'Call-ID: {a}\r\nCSeq: {cseq} {method}\r\nMax-Forwards: 70\r\n'
 for value in values(msg,'Record-Route'):packet+='Route: '+value+'\r\n'
 packet+='Content-Length: 0\r\n\r\n';carrier.sendto(packet.encode(),('127.0.0.1',5060))
 receive(fs,method+' sip:phone11-recording-3001@')
# FS originates B leg: a different exact SIP identity reaches wake/device.
b=invite(fs,'3001','returned-v1');msg=receive(device,'INVITE sip:3001@');assert f'Call-ID: {b}' in msg;assert b!=a;assert 'X-Fixture-Wake-Flow: reached' in msg;assert 'Recording-Anchor:' not in msg
# A pre-answer CANCEL follows the existing matching transaction path.
c=invite(carrier,'020303001');pending=receive(fs,'Call-ID: '+c)
ring='SIP/2.0 180 Ringing\r\n'
for key in ['Via','From','To','Call-ID','CSeq']:
 for value in values(pending,key):ring+=key+': '+value+'\r\n'
ring+='Content-Length: 0\r\n\r\n';fs.sendto(ring.encode(),('127.0.0.1',5060));receive(carrier,'180 Ringing')
cancel='CANCEL sip:020303001@127.0.0.1 SIP/2.0\r\n'
# Use the original client's Via branch, not the proxy's top Via.
for key in ['Via','From','To','Call-ID']:
 vals=values(pending,key)
 if key=='Via':vals=vals[-1:]
 for value in vals:cancel+=key+': '+value+'\r\n'
cancel+='CSeq: 1 CANCEL\r\nMax-Forwards: 70\r\nContent-Length: 0\r\n\r\n'
carrier.sendto(cancel.encode(),('127.0.0.1',5060));receive(fs,'CANCEL sip:phone11-recording-3001@')
# Wrong return destination and forged carrier return marker fail closed.
invite(fs,'020303001','returned-v1');receive(fs,'403 Invalid recording route')
invite(carrier,'3001','returned-v1');receive(carrier,'403 Invalid recording route')
# Normal/emergency/outbound traffic continues the pre-existing route.
for number in ['191','1669','3002','0891234567']:
 invite(carrier,number);receive(carrier,'404 Existing route unchanged')
print('PASS: carrier-to-FS, downstream wake boundary, loop/spoof refusal, nonpilot preservation')
