"""Real Kamailio transactions with synthetic FS/device; no RTP acceptance claim."""
import socket, uuid, re, threading
failures=[]

def bencode(value):
    if isinstance(value, str): value=value.encode()
    if isinstance(value, bytes): return str(len(value)).encode()+b":"+value
    if isinstance(value, dict): return b"d"+b"".join(bencode(k)+bencode(v) for k,v in sorted(value.items()))+b"e"
    raise TypeError(value)

def bdecode(data, offset=0):
    kind=data[offset:offset+1]
    if kind in (b"d", b"l"):
        result={} if kind==b"d" else []; offset+=1
        while data[offset:offset+1]!=b"e":
            value,offset=bdecode(data,offset)
            if kind==b"d": other,offset=bdecode(data,offset);result[value]=other
            else: result.append(value)
        return result,offset+1
    if kind==b"i":
        end=data.index(b"e",offset);return int(data[offset+1:end]),end+1
    end=data.index(b":",offset);length=int(data[offset:end]);offset=end+1
    return data[offset:offset+length].decode(),offset+length

ng_commands=[]
ng=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);ng.bind(("0.0.0.0",22222))
def receive_ng():
    while True:
        raw,peer=ng.recvfrom(65535)
        cookie,payload=raw.split(b" ",1)
        try:
            command,_=bdecode(payload);ng_commands.append(command)
            result={"result":"pong" if command["command"]=="ping" else "ok"}
            if command["command"] in ["offer","answer"]: result["sdp"]=command["sdp"]
            ng.sendto(cookie+b" "+bencode(result),peer)
        except Exception as error: failures.append(repr(error))
threading.Thread(target=receive_ng,daemon=True).start()

def commands(callid,command):
    return [item for item in ng_commands if item.get("call-id")==callid and item["command"]==command]


SDP="v=0\r\no=fixture 1 1 IN IP4 192.0.2.1\r\ns=fixture\r\nc=IN IP4 192.0.2.1\r\nt=0 0\r\nm=audio 9000 RTP/AVP 8\r\na=rtpmap:8 PCMA/8000\r\n"
SECURE_SDP="v=0\r\no=phone 1 1 IN IP4 192.0.2.2\r\ns=fixture\r\nc=IN IP4 192.0.2.2\r\nt=0 0\r\nm=audio 9002 RTP/SAVP 8\r\na=rtpmap:8 PCMA/8000\r\na=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:dGVzdC1vbmx5LWtleS1tYXRlcmlhbA==\r\n"

def sock(ip,port):
 s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.bind((ip,port));s.settimeout(3);return s
carrier=sock('127.0.0.2',6000);fs=sock('127.0.0.1',5080);device=sock('127.0.0.1',6001)
def invite(s,dest,marker=None,extra_headers=()):
 ip,port=s.getsockname();cid=str(uuid.uuid4())+'@fixture'
 msg=f'INVITE sip:{dest}@127.0.0.1 SIP/2.0\r\nVia: SIP/2.0/UDP {ip}:{port};branch=z9hG4bK{uuid.uuid4().hex}\r\nFrom: <sip:caller@fixture>;tag=test\r\nTo: <sip:{dest}@fixture>\r\nCall-ID: {cid}\r\nCSeq: 1 INVITE\r\nMax-Forwards: 70\r\nContact: <sip:caller@{ip}:{port}>\r\n'
 if marker:msg+=f'X-Phone11-Recording-Anchor: {marker}\r\n'
 for header in extra_headers:msg+=header+'\r\n'
 msg+=f'Content-Type: application/sdp\r\nContent-Length: {len(SDP)}\r\n\r\n'+SDP;s.sendto(msg.encode(),('127.0.0.1',5060));return cid

def receive(s,contains):
 while True:
  msg=s.recv(65535).decode()
  if contains in msg:return msg
# Carrier reaches FS, never the synthetic device directly.
a=invite(carrier,'020303001');msg=receive(fs,'INVITE sip:phone11-recording-3001@');assert f'Call-ID: {a}' in msg;assert 'ingress-v1' in msg
# Complete the anchored A dialog using the real proxy's Record-Route.
def values(packet,key):return re.findall(r'^'+re.escape(key)+r': (.+)\r$',packet,re.M|re.I)
def answer(invite_packet,sock,sdp,tag):
 reply='SIP/2.0 200 OK\r\n'
 for key in ['Via','From','To','Call-ID','CSeq','Record-Route']:
  for value in values(invite_packet,key):reply+=key+': '+value+(';tag='+tag if key=='To' else '')+'\r\n'
 reply+=f'Contact: <sip:3001@{sock.getsockname()[0]}:{sock.getsockname()[1]}>\r\n'
 reply+=f'Content-Type: application/sdp\r\nContent-Length: {len(sdp)}\r\n\r\n'+sdp
 sock.sendto(reply.encode(),('127.0.0.1',5060))
reply='SIP/2.0 200 OK\r\n'
for key in ['Via','From','To','Call-ID','CSeq','Record-Route']:
 for value in values(msg,key):reply+=key+': '+value+(';tag=anchored-fs' if key=='To' else '')+'\r\n'
reply+='Contact: <sip:phone11-recording-3001@127.0.0.1:5080>\r\n'+f'Content-Type: application/sdp\r\nContent-Length: {len(SDP)}\r\n\r\n'+SDP
fs.sendto(reply.encode(),('127.0.0.1',5060));receive(carrier,'200 OK')
# Unsupported delayed-offer re-INVITE is rejected, without touching media.
no_sdp=f'INVITE sip:phone11-recording-3001@127.0.0.1:5080 SIP/2.0\r\nVia: SIP/2.0/UDP 127.0.0.2:6000;branch=z9hG4bK{uuid.uuid4().hex}\r\n'
no_sdp+='From: '+values(msg,'From')[0]+'\r\nTo: '+values(msg,'To')[0]+';tag=anchored-fs\r\n'
no_sdp+=f'Call-ID: {a}\r\nCSeq: 2 INVITE\r\nMax-Forwards: 70\r\n'
for value in values(msg,'Record-Route'):no_sdp+='Route: '+value+'\r\n'
no_sdp+='Content-Length: 0\r\n\r\n'
media_before=len(ng_commands)
carrier.sendto(no_sdp.encode(),('127.0.0.1',5060));receive(carrier,'488 SDP required')
assert len(ng_commands)==media_before
fs.settimeout(0.2)
try:
 unexpected=fs.recv(65535);raise AssertionError('Offerless re-INVITE was relayed')
except socket.timeout:pass
finally:fs.settimeout(3)
for method,cseq in [('ACK',1),('INVITE',3),('BYE',4)]:
 if method=='BYE':
  reverse=f'INVITE sip:caller@127.0.0.2:6000 SIP/2.0\r\nVia: SIP/2.0/UDP 127.0.0.1:5080;branch=z9hG4bK{uuid.uuid4().hex}\r\n'
  reverse+='From: '+values(msg,'To')[0]+';tag=anchored-fs\r\nTo: '+values(msg,'From')[0]+'\r\n'
  reverse+=f'Call-ID: {a}\r\nCSeq: 5 INVITE\r\nMax-Forwards: 70\r\n'
  for value in values(msg,'Record-Route'):reverse+='Route: '+value+'\r\n'
  reverse+=f'Content-Type: application/sdp\r\nContent-Length: {len(SDP)}\r\n\r\n'+SDP
  fs.sendto(reverse.encode(),('127.0.0.1',5060));receive(carrier,'INVITE sip:caller@')
 packet=f'{method} sip:phone11-recording-3001@127.0.0.1:5080 SIP/2.0\r\nVia: SIP/2.0/UDP 127.0.0.2:6000;branch=z9hG4bK{uuid.uuid4().hex}\r\n'
 packet+='From: '+values(msg,'From')[0]+'\r\nTo: '+values(msg,'To')[0]+';tag=anchored-fs\r\n'
 packet+=f'Call-ID: {a}\r\nCSeq: {cseq} {method}\r\nMax-Forwards: 70\r\n'
 for value in values(msg,'Record-Route'):packet+='Route: '+value+'\r\n'
 packet+=(f'Content-Type: application/sdp\r\nContent-Length: {len(SDP)}\r\n\r\n'+SDP) if method in ['INVITE','ACK'] else 'Content-Length: 0\r\n\r\n';carrier.sendto(packet.encode(),('127.0.0.1',5060))
 receive(fs,method+' sip:phone11-recording-3001@')
# Preserve every exact currently accepted DID spelling, without broadening it.
for number in ['6620303001','+6620303001']:
 exact=invite(carrier,number);forwarded=receive(fs,'Call-ID: '+exact)
 assert forwarded.startswith('INVITE sip:phone11-recording-3001@')
# FS originates B leg: a different exact SIP identity reaches wake/device.
b=invite(fs,'3001','returned-v1');msg=receive(device,'INVITE sip:3001@');assert f'Call-ID: {b}' in msg;assert b!=a;assert 'X-Fixture-Wake-Flow: reached' in msg;assert 'Recording-Anchor:' not in msg
answer(msg,device,SECURE_SDP,'phone-origin-answer');receive(fs,'200 OK')
# Exercise the reverse offer-leg branch used when the handset originated the offer.
b_reverse=invite(fs,'3001','returned-v1',['X-Fixture-Phone-Offer: yes']);reverse_msg=receive(device,'INVITE sip:3001@');assert f'Call-ID: {b_reverse}' in reverse_msg
answer(reverse_msg,device,SECURE_SDP,'phone-reverse-answer');receive(fs,'200 OK')
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
# Failed initial setup deletes its allocated media session.
f=invite(carrier,'020303001');failed_invite=receive(fs,'Call-ID: '+f)
failed='SIP/2.0 486 Busy Here\r\n'
for key in ['Via','From','To','Call-ID','CSeq']:
 for value in values(failed_invite,key):failed+=key+': '+value+(';tag=busy' if key=='To' else '')+'\r\n'
failed+='Content-Length: 0\r\n\r\n';fs.sendto(failed.encode(),('127.0.0.1',5060));receive(carrier,'486 Busy Here')
assert commands(f,'delete')
# Wrong return destination and forged carrier return marker fail closed.
invite(fs,'020303001','returned-v1');receive(fs,'403 Invalid recording route')
invite(carrier,'3001','returned-v1');receive(carrier,'403 Invalid recording route')
# Normal/emergency/outbound traffic continues the pre-existing route.
for number in ['191','1669','3002','0891234567','0203030010','66203030010','+66203030010','20303001','+020303001','06620303001']:
 invite(carrier,number);receive(carrier,'404 Existing route unchanged')
assert commands(a,'offer') and commands(a,'answer') and commands(a,'delete')
assert commands(c,'delete')
for call in [a,c]:
 for item in commands(call,'offer'):
  assert item['direction'] in [['pub','priv'],['priv','pub']];assert item['transport-protocol']=='RTP/AVP'
assert commands(a,'answer')[0]['direction']==['priv','pub']
assert commands(a,'offer')[0]['direction']==['pub','priv']
assert any(item['direction']==['priv','pub'] for item in commands(a,'offer'))
assert any(item['direction']==['pub','priv'] for item in commands(a,'answer'))
for call,direction in [(b,['pub','priv']),(b_reverse,['priv','pub'])]:
 answers=commands(call,'answer');assert len(answers)==1,answers
 item=answers[0]
 assert item['direction']==direction,item
 assert item['transport-protocol']=='RTP/AVP',item
 assert item['ICE']=='remove',item
 assert item['DTLS']=='off',item
 assert item['SDES']==['off'],item
 assert item['address-family']=='IP4',item
assert not failures,failures
print('PASS: carrier-to-FS, downstream wake boundary, secure phone-answer translation, loop/spoof refusal, nonpilot preservation')
