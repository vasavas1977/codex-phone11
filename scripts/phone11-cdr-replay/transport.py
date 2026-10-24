"""Source-only fixed3030 single-attempt CDR transport; no CLI or credential loader.

The trusted caller must supply reviewed current runtime/auth attestation. This
adapter is not spool admission or producer-completion proof and never reads one.
"""
import base64,re,socket,time
SOURCE_SHA='73038405a623499d8907f6c77d09939532bee74d1d9df15021c21072b99bff10'
ADDRESS=('127.0.0.1',3030);PATH=b'/api/freeswitch/cdr';MAX_BODY=524292;MAX_HEADERS=8192;MAX_RESPONSE=1024
class Refused(Exception):pass
def need(value,code):
 if not value:raise Refused(code)
class Transport:
 def __init__(self,secret,attest,*,socket_factory=socket.socket,clock=time.monotonic):
  need(type(secret)is str and 24<=len(secret)<=4096 and not re.search(r'change[-_ ]?me|example|placeholder',secret,re.I),'AUTH_UNBOUND')
  need(callable(attest)and callable(socket_factory)and callable(clock),'ADAPTER_UNBOUND');self._secret=secret;self._attest=attest;self._socket=socket_factory;self._clock=clock
 def __call__(self,body,timeout):
  need(type(timeout)in(int,float)and 0<timeout<=5,'TIMEOUT_BOUND');need(type(body)is bytes and 4<len(body)<=MAX_BODY and body.startswith(b'cdr=')and re.fullmatch(rb'(?:[A-Za-z0-9_.~-]|%[0-9A-Fa-f]{2})+',body[4:])is not None,'UNCHANGED_FORM_BODY')
  end=self._clock()+timeout
  def remaining():
   value=end-self._clock();need(value>0,'HTTP_TOTAL_DEADLINE');return value
  def attested():
   try:good=self._attest(SOURCE_SHA,end)
   except Exception:raise Refused('RUNTIME_ATTESTATION_UNPROVEN')from None
   need(good is True,'RUNTIME_ATTESTATION_UNPROVEN');remaining()
  attested();peer=None;result=None
  try:
   authorization=base64.b64encode(('phone11-cdr:'+self._secret).encode('utf-8'))
   request=b'POST '+PATH+b' HTTP/1.1\r\nHost: 127.0.0.1:3030\r\nContent-Type: application/x-www-form-urlencoded\r\nAuthorization: Basic '+authorization+b'\r\nContent-Length: '+str(len(body)).encode()+b'\r\nConnection: close\r\n\r\n'+body
   peer=self._socket(socket.AF_INET,socket.SOCK_STREAM);peer.settimeout(remaining());peer.connect(ADDRESS);peer.settimeout(remaining());peer.sendall(request);request=authorization=None
   response=bytearray();header_end=None;length=None;status=None
   while True:
    peer.settimeout(remaining());part=peer.recv(min(4096,MAX_HEADERS+MAX_RESPONSE+5-len(response)));remaining()
    if not part:break
    response.extend(part);need(len(response)<=MAX_HEADERS+MAX_RESPONSE+4,'HTTP_RESPONSE_BOUND')
    if header_end is None:
     marker=response.find(b'\r\n\r\n')
     if marker<0:need(len(response)<=MAX_HEADERS,'HTTP_HEADER_BOUND');continue
     need(marker<=MAX_HEADERS,'HTTP_HEADER_BOUND');head=bytes(response[:marker]);header_end=marker+4;lines=head.split(b'\r\n');match=re.fullmatch(rb'HTTP/1\.[01] ([2-5][0-9]{2}) [\x20-\x7e]{0,120}',lines[0]);need(match is not None,'HTTP_STATUS');status=int(match[1]);headers={}
     for line in lines[1:]:
      name,colon,value=line.partition(b':');need(colon and re.fullmatch(rb'[A-Za-z0-9!#$%&\'*+.^_`|~-]{1,64}',name)is not None,'HTTP_HEADER_SHAPE');name=name.lower();need(name not in headers,'HTTP_DUPLICATE_HEADER');headers[name]=value.strip();need(all(c>=32 and c!=127 for c in value),'HTTP_HEADER_VALUE')
     need(b'transfer-encoding'not in headers and b'content-encoding'not in headers,'HTTP_AMBIGUOUS_ENCODING');raw_length=headers.get(b'content-length',b'');need(re.fullmatch(rb'(?:0|[1-9][0-9]{0,3})',raw_length)is not None,'HTTP_CONTENT_LENGTH');length=int(raw_length);need(length<=MAX_RESPONSE,'HTTP_BODY_BOUND');need(headers.get(b'content-type',b'').split(b';')[0].strip().lower()==b'application/json','HTTP_CONTENT_TYPE')
    if header_end is not None:need(len(response)-header_end<=length,'HTTP_TRAILING_OR_OVERSIZE_BODY')
   need(header_end is not None and len(response)-header_end==length,'HTTP_TRUNCATED_BODY');result=(status,bytes(response[header_end:]));remaining()
  except Refused:raise
  except Exception:raise Refused('HTTP_OUTCOME_UNKNOWN')from None
  finally:
   if peer is not None:
    try:peer.close()
    except Exception:raise Refused('HTTP_CLOSE_UNKNOWN')from None
  attested();return result
