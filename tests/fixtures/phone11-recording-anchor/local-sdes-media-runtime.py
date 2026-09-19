"""Isolated RTPengine proof for a native Siprix-to-Siprix SDES local call.

Run in the existing RTPengine image with --network none. This proves only SDP
negotiation; it does not claim handset audio, registration, or live routing.
"""
import base64
import pathlib
import re
import socket
import subprocess
import time
import uuid


def encode(value):
    if isinstance(value, str): value = value.encode()
    if isinstance(value, bytes): return str(len(value)).encode() + b":" + value
    if isinstance(value, list): return b"l" + b"".join(map(encode, value)) + b"e"
    if isinstance(value, dict): return b"d" + b"".join(encode(k) + encode(v) for k, v in sorted(value.items())) + b"e"
    raise TypeError(value)


def decode(data, offset=0):
    kind = data[offset:offset + 1]
    if kind in (b"d", b"l"):
        result = {} if kind == b"d" else []
        offset += 1
        while data[offset:offset + 1] != b"e":
            value, offset = decode(data, offset)
            if kind == b"d":
                other, offset = decode(data, offset)
                result[value] = other
            else: result.append(value)
        return result, offset + 1
    end = data.index(b":", offset)
    length = int(data[offset:end])
    return data[end + 1:end + 1 + length].decode(), end + 1 + length


def flags(text):
    result = {}
    for token in text.split():
        if token.startswith("replace-"): result.setdefault("replace", []).append(token[8:])
        elif token.startswith("SDES-"): result.setdefault("SDES", []).append(token[5:])
        elif "=" in token:
            key, value = token.split("=", 1)
            result.setdefault(key, []).append(value) if key == "direction" else result.__setitem__(key, value)
        elif token == "rtcp-mux-demux": result["rtcp-mux"] = ["demux"]
    return result


source = pathlib.Path("/work/infra/configs/kamailio/kamailio.cfg").read_text(encoding="utf-8")
route = source.split("route[PHONE11_LOCAL_EXTENSION_MEDIA] {", 1)[1].split("route[PHONE11_LOCAL_EXTENSION_DIALOG_MEDIA] {", 1)[0]
reply = source.split("onreply_route[LOCAL_EXTENSION_REPLY] {", 1)[1].split("# Named reply route for FreeSWITCH", 1)[0]
dialog = source.split("route[PHONE11_LOCAL_EXTENSION_DIALOG_MEDIA] {", 1)[1].split("# ---- INVITE Routing ----", 1)[0]
offer_flags = re.findall(r'rtpengine_offer\("([^"]+)"\)', route + dialog)
answer_flags = re.findall(r'rtpengine_answer\("([^"]+)"\)', reply + dialog)
assert len(offer_flags) == 2 and len(answer_flags) == 2
for value in offer_flags + answer_flags:
    for expected in ["ICE=remove", "DTLS=off", "rtcp-mux-demux", "transport-protocol=RTP/SAVP", "SDES-only-AES_CM_128_HMAC_SHA1_80", "direction=pub direction=pub", "address-family=IP4"]:
        assert expected in value, value

plain = "v=0\r\no=fixture 1 1 IN IP4 127.0.0.1\r\ns=fixture\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\nm=audio 9000 RTP/SAVP 8\r\na=rtpmap:8 PCMA/8000\r\na=sendrecv\r\n"
secure = plain + "a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:" + base64.b64encode(b"012345678901234567890123456789").decode() + "\r\n"


def assert_secure(result):
    sdp = result["sdp"]
    assert re.search(r"m=audio \d+ RTP/SAVP 8\r", sdp), "RTP/SAVP missing"
    assert "a=crypto:" in sdp and "AES_CM_128_HMAC_SHA1_80 inline:" in sdp, "SDES missing"


sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.settimeout(2)


def send(message):
    cookie = uuid.uuid4().hex.encode()
    sock.sendto(cookie + b" " + encode(message), ("127.0.0.1", 22222))
    result = decode(sock.recv(65535).split(b" ", 1)[1])[0]
    assert result["result"] in ["ok", "pong"], result
    return result


p = subprocess.Popen(["rtpengine", "--config-file=none", "-f", "-E", "--log-level=2", "--table=-1", "--interface=pub/127.0.0.1", "--interface=priv/127.0.0.2", "--listen-ng=127.0.0.1:22222", "--port-min=20000", "--port-max=20100"], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
try:
    time.sleep(1)
    if p.poll() is not None: raise RuntimeError(p.stderr.read().decode())
    send({"command": "ping"})
    call = "local-sdes-" + uuid.uuid4().hex
    assert_secure(send({"command": "offer", "call-id": call, "from-tag": "1020", "sdp": secure, **flags(offer_flags[0])}))
    assert_secure(send({"command": "answer", "call-id": call, "from-tag": "1020", "to-tag": "3001", "sdp": secure, **flags(answer_flags[0])}))
    assert_secure(send({"command": "offer", "call-id": call, "from-tag": "3001", "to-tag": "1020", "sdp": secure, **flags(offer_flags[1])}))
    assert_secure(send({"command": "answer", "call-id": call, "from-tag": "3001", "to-tag": "1020", "sdp": secure, **flags(answer_flags[1])}))
    send({"command": "delete", "call-id": call})
    print("PASS: native local SDES offer, answer, re-INVITE, and ACK-answer all retain RTP/SAVP AES_CM_128_HMAC_SHA1_80")
finally:
    p.terminate()
    p.wait(timeout=5)
