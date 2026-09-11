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
    return "\r\n".join(lines) + "\r\nContent-Length: 0\r\n\r\n"

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
            callee.sendto(response(message,486,"Busy Here").encode(),peer)
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

for mode in ["ready", "cancel", "unavailable", "invalid-json", "invalid-uuid", "invalid-types", "timeout"]:
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
    elif mode=="ready":
        item["release"].set();wait_for(lambda:any(headers(p,"Call-ID")==[callid] for p in packets))
        time.sleep(.2)
        forwarded=[p for p in packets if headers(p,"Call-ID")==[callid]]
        assert len(forwarded)==1,"more than one resumed INVITE branch"
        assert headers(forwarded[0],"X-Phone11-Wake-ID")==[item["uuid"]],"wake UUID spoof/duplicate/mismatch"
        assert forwarded[0].split("\r\n\r\n",1)[1]==SDP,"original SDP changed"
        assert headers(forwarded[0],"From")==headers(invite,"From"),"original caller changed"
        wait_for(lambda:"ended" in item["terminals"])
    else:
        item["release"].set()
        replies=responses(callid,31 if mode=="timeout" else 1)
        assert any(msg.startswith("SIP/2.0 480") for msg in replies),"unavailable/invalid response did not terminate"
        assert not any(headers(p,"Call-ID")==[callid] for p in packets),"invalid response forwarded INVITE"
        wait_for(lambda:"cancelled" in item["terminals"])
    assert not failures,failures
    print("PASS synthetic SIP "+mode,flush=True)
print("PASS 7 isolated SIP transaction scenarios; no live endpoints",flush=True)
