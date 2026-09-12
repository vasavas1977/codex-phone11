"""Synthetic endpoints only; runs inside an isolated internal Docker network."""
import json, re, socket, threading, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

scenarios, packets, failures = {}, [], []
lock = threading.Lock()
SDP = "v=0\r\no=fixture 1 1 IN IP4 192.0.2.1\r\ns=synthetic\r\nc=IN IP4 192.0.2.1\r\nt=0 0\r\nm=audio 9000 RTP/AVP 0\r\na=rtpmap:0 PCMU/8000\r\n"

def headers(message, key):
    return [value.rstrip("\r") for value in re.findall(r"^" + re.escape(key) + r":\s*(.+)\r?$", message, re.M | re.I)]

def response(request, code, reason):
    lines = [f"SIP/2.0 {code} {reason}"]
    for key in ["Via", "From", "To", "Call-ID", "CSeq"]:
        values = headers(request, key)
        for value in values:
            if key == "To" and ";tag=" not in value: value += ";tag=fixture-callee"
            lines.append(f"{key}: {value}")
    if code==200 and headers(request,"CSeq")==["1 INVITE"]:
        lines.append("Contact: <sip:1001@fixture:6001>")
        lines.extend("Record-Route: "+value for value in headers(request,"Record-Route"))
    return "\r\n".join(lines) + "\r\nContent-Length: 0\r\n\r\n"

# Minimal NG control peer: actual Kamailio module serialization is exercised.
# This does not send or receive RTP audio.
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
            if command["command"]=="offer": result["sdp"]=command["sdp"]
            ng.sendto(cookie+b" "+bencode(result),peer)
        except Exception as error: failures.append(repr(error))
threading.Thread(target=receive_ng,daemon=True).start()

def commands(callid,command):
    return [item for item in ng_commands if item.get("call-id")==callid and item["command"]==command]

class HTTP(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_POST(self):
        try:
            assert self.headers.get("X-Push-Secret") == "synthetic-runtime-test-only"
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            assert body["sipUri"] == "sip:1001@test.invalid"
            item = scenarios[body["sipCallId"]]
            if self.path.endswith("/terminal"):
                item["terminals"].append(body["status"])
                payload, code = b'{"ok":true}', 200
            else:
                assert self.path == "/api/phone11/wake/offer"
                item["offers"] += 1; item["arrived"].set()
                assert item["release"].wait(8), "test failed to release mock HTTP reply"
                if item["mode"] == "timeout": time.sleep(30)
                if item["mode"] == "unavailable": payload, code = b'{"error":"unavailable"}', 503
                elif item["mode"] == "invalid-json": payload, code = b'not-json', 200
                elif item["mode"] == "invalid-types": payload, code = b'{"v":"wrong","status":123,"callUUID":true}', 200
                elif item["mode"] == "invalid-uuid": payload, code = b'{"v":1,"status":"ready","callUUID":"caller-controlled"}', 200
                else: payload, code = json.dumps({"v":1,"status":"ready","callUUID":item["uuid"]}).encode(), 200
            self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(payload))); self.end_headers(); self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError): pass
        except Exception as error: failures.append(repr(error)); self.send_error(500)

server=ThreadingHTTPServer(("0.0.0.0",8080),HTTP)
threading.Thread(target=server.serve_forever,daemon=True).start()
callee=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); callee.bind(("0.0.0.0",6001));callee.settimeout(.1)
def receive_calls():
    while True:
        try: raw, peer=callee.recvfrom(65535)
        except socket.timeout: continue
        message=raw.decode()
        if message.startswith("INVITE "):
            with lock: packets.append(message)
            callee.sendto(response(message,100,"Trying").encode(),peer)
            if scenarios[headers(message,"Call-ID")[0]]["mode"]=="media-success":
                callee.sendto(response(message,200,"OK").encode(),peer)
            elif scenarios[headers(message,"Call-ID")[0]]["mode"] not in ("media-timeout", "media-cancel", "media-race"):
                callee.sendto(response(message,486,"Busy Here").encode(),peer)
        elif message.startswith("CANCEL "):
            if scenarios[headers(message,"Call-ID")[0]]["mode"]=="media-timeout": continue
            callee.sendto(response(message,200,"OK").encode(),peer)
            original=next(p for p in packets if headers(p,"Call-ID")==headers(message,"Call-ID"))
            if scenarios[headers(message,"Call-ID")[0]]["mode"]=="media-race":
                callee.sendto(response(original,200,"OK").encode(),peer)
            else:
                callee.sendto(response(original,487,"Request Terminated").encode(),peer)
threading.Thread(target=receive_calls,daemon=True).start()
caller=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);caller.bind(("0.0.0.0",6000));caller.settimeout(.1)
proxy=("proxy",15060)

def request(method,callid,branch,body="",extra=""):
    target="sip:test.invalid" if method=="REGISTER" else "sip:1001@test.invalid"
    return (f"{method} {target} SIP/2.0\r\nVia: SIP/2.0/UDP fixture:6000;branch=z9hG4bK{branch}\r\nMax-Forwards: 70\r\nFrom: <sip:1001@test.invalid>;tag=caller-{callid}\r\nTo: <sip:1001@test.invalid>\r\nCall-ID: {callid}\r\nCSeq: 1 {method}\r\nContact: <sip:1001@fixture:6001>\r\n{extra}"+("Content-Type: application/sdp\r\n" if body else "")+f"Content-Length: {len(body.encode())}\r\n\r\n{body}")

def wait_for(predicate, seconds=4):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        if predicate(): return
        time.sleep(.02)
    raise AssertionError("timed out waiting for synthetic scenario")

def responses(callid,seconds=.3):
    found=[]; deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        try: raw,_=caller.recvfrom(65535)
        except socket.timeout: continue
        msg=raw.decode()
        if headers(msg,"Call-ID")==[callid]: found.append(msg)
    return found

# Establish an entirely synthetic registrar contact; startup retry is bounded.
registered=False
for _ in range(40):
    caller.sendto(request("REGISTER","register-fixture","register",extra="Expires: 300\r\n").encode(),proxy)
    if any(msg.startswith("SIP/2.0 200") for msg in responses("register-fixture",.2)):
        registered=True;break
    time.sleep(.1)
assert registered,"isolated proxy did not accept synthetic REGISTER"

for mode in ["ready", "cancel", "unavailable", "invalid-json", "invalid-uuid", "invalid-types", "timeout", "media-cancel", "media-timeout", "media-success", "media-race", "media-relay-error"]:
    callid="fixture-"+mode+"-"+str(uuid.uuid4())
    item={"uuid":str(uuid.uuid4()),"offers":0,"arrived":threading.Event(),"release":threading.Event(),"mode":mode,"terminals":[]};scenarios[callid]=item
    invite=request("INVITE",callid,callid,SDP,extra="X-Phone11-Wake-ID: spoofed-caller-value\r\nX-Phone11-Wake-ID: another-spoof\r\n")
    caller.sendto(invite.encode(),proxy);assert item["arrived"].wait(4),"wake HTTP request absent"
    assert not any(headers(p,"Call-ID")==[callid] for p in packets),"INVITE forwarded before wake ready"
    caller.sendto(invite.encode(),proxy);caller.sendto(invite.encode(),proxy)
    time.sleep(.15);assert item["offers"]==1,"INVITE retransmission duplicated wake HTTP request"
    if mode=="cancel":
        caller.sendto(request("CANCEL",callid,callid).encode(),proxy)
        wait_for(lambda:"cancelled" in item["terminals"])
        item["release"].set();time.sleep(.5)
        assert not any(headers(p,"Call-ID")==[callid] for p in packets),"late ready resumed a cancelled INVITE"
    elif mode=="media-relay-error":
        item["release"].set()
        replies=responses(callid,2)
        assert any(msg.startswith("SIP/2.0 500") for msg in replies),"immediate relay error response absent"
        wait_for(lambda:bool(commands(callid,"delete")))
        assert len(commands(callid,"offer"))==1,"relay-error media was not allocated"
        assert not any(headers(p,"Call-ID")==[callid] for p in packets),"unsupported transport unexpectedly relayed"
        wait_for(lambda:"cancelled" in item["terminals"])
    elif mode in ("ready", "media-cancel", "media-timeout", "media-success", "media-race"):
        item["release"].set();wait_for(lambda:any(headers(p,"Call-ID")==[callid] for p in packets))
        time.sleep(.2)
        forwarded=[p for p in packets if headers(p,"Call-ID")==[callid]]
        assert len(forwarded)==1,"more than one resumed INVITE branch"
        assert headers(forwarded[0],"X-Phone11-Wake-ID")==[item["uuid"]],"wake UUID spoof/duplicate/mismatch"
        assert forwarded[0].split("\r\n\r\n",1)[1]==SDP,"original SDP changed"
        assert headers(forwarded[0],"From")==headers(invite,"From"),"original caller changed"
        if mode in ("media-cancel", "media-race"):
            caller.sendto(request("CANCEL",callid,callid).encode(),proxy)
        if mode in ("media-success", "media-race"):
            replies=responses(callid,1)
            assert any(msg.startswith("SIP/2.0 200") and headers(msg,"CSeq")==["1 INVITE"] for msg in replies),"successful INVITE response absent"
            assert not commands(callid,"delete"),"successful or racing 200 call media deleted"
            assert "ended" not in item["terminals"],"successful call marked ended"
        else:
            wait_for(lambda:bool(item["terminals"]),35 if mode=="media-timeout" else 4)
            wait_for(lambda:bool(commands(callid,"delete")))
            assert commands(callid,"delete")[0]["from-tag"]=="caller-"+callid,"cleanup did not preserve owning tag"
        assert len(commands(callid,"offer"))==1,"media offer duplicated"
    else:
        item["release"].set()
        replies=responses(callid,31 if mode=="timeout" else 1)
        assert any(msg.startswith("SIP/2.0 480") for msg in replies),"unavailable/invalid response did not terminate"
        assert not any(headers(p,"Call-ID")==[callid] for p in packets),"invalid response forwarded INVITE"
        wait_for(lambda:"cancelled" in item["terminals"])
    if mode not in ("ready", "media-cancel", "media-timeout", "media-success", "media-race", "media-relay-error"):
        assert not commands(callid,"offer") and not commands(callid,"delete"),"unallocated call touched media"
    assert not failures,failures
    print("PASS synthetic SIP "+mode,flush=True)
print("PASS 12 isolated SIP transaction/media cleanup scenarios; no live endpoints",flush=True)
