"""Isolated real RTPengine SDP negotiation; no PSTN/media-audio acceptance claim.

Run inside an RTPengine image with --network none. No production sockets used.
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
    if isinstance(value, bytes): return str(len(value)).encode() + b':' + value
    if isinstance(value, list): return b'l' + b''.join(map(encode, value)) + b'e'
    if isinstance(value, dict): return b'd' + b''.join(encode(k) + encode(v) for k, v in sorted(value.items())) + b'e'
    raise TypeError(value)


def decode(data, offset=0):
    kind = data[offset:offset + 1]
    if kind in (b'd', b'l'):
        result = {} if kind == b'd' else []
        offset += 1
        while data[offset:offset + 1] != b'e':
            value, offset = decode(data, offset)
            if kind == b'd':
                other, offset = decode(data, offset)
                result[value] = other
            else: result.append(value)
        return result, offset + 1
    if kind == b'i':
        end = data.index(b'e', offset)
        return int(data[offset + 1:end]), end + 1
    end = data.index(b':', offset)
    length = int(data[offset:end])
    return data[end + 1:end + 1 + length].decode(), end + 1 + length


plain = 'v=0\r\no=fixture 1 1 IN IP4 127.0.0.1\r\ns=fixture\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\nm=audio 9000 RTP/AVP 8\r\na=rtpmap:8 PCMA/8000\r\na=sendrecv\r\n'
secure = plain.replace('RTP/AVP', 'RTP/SAVP') + 'a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:' + base64.b64encode(b'012345678901234567890123456789').decode() + '\r\n'
source = pathlib.Path('/work/infra/configs/kamailio/phone11-recording-anchor-candidate/routes.inc').read_text()
helper = source.split('route[PHONE11_RECORDING_ANCHOR_INBOUND_REPLY] {', 1)[1].split('onreply_route[', 1)[0]
answer_flags = re.findall(r'rtpengine_answer\("([^"]+)"\)', helper)
assert len(answer_flags) == 2


def flags(text):
    result = {}
    for token in text.split():
        if token.startswith('replace-'): result.setdefault('replace', []).append(token[8:])
        elif token.startswith('SDES-'): result.setdefault('SDES', []).append(token[5:])
        elif '=' in token:
            key, value = token.split('=', 1)
            if key in ['direction', 'SDES']: result.setdefault(key, []).append(value)
            else: result[key] = value
        elif token == 'rtcp-mux-demux': result['rtcp-mux'] = ['demux']
    return result


sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.settimeout(2)

def send(message):
    cookie = uuid.uuid4().hex.encode()
    sock.sendto(cookie + b' ' + encode(message), ('127.0.0.1', 22222))
    result = decode(sock.recv(65535).split(b' ', 1)[1])[0]
    assert result['result'] in ['ok', 'pong'], result
    return result


def expect_sdp(result, protocol):
    sdp = result['sdp']
    assert re.search(r'm=audio \d+ ' + re.escape(protocol) + r' 8\r', sdp), sdp
    if protocol == 'RTP/SAVP':
        assert 'a=crypto:' in sdp and 'AES_CM_128_HMAC_SHA1_80 inline:' in sdp, sdp
    else: assert 'a=crypto:' not in sdp and 'a=fingerprint:' not in sdp, sdp


p = subprocess.Popen(['rtpengine', '--config-file=none', '-f', '-E', '--log-level=2', '--table=-1', '--interface=pub/127.0.0.1', '--interface=priv/127.0.0.2', '--listen-ng=127.0.0.1:22222', '--port-min=20000', '--port-max=20100'], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
try:
    time.sleep(1)
    if p.poll() is not None: raise RuntimeError(p.stderr.read().decode())
    send({'command': 'ping'})
    call = 'isolated-media-' + uuid.uuid4().hex
    # FS plain offer becomes secure toward phone.
    offer = send({'command': 'offer', 'call-id': call, 'from-tag': 'fs', 'sdp': plain,
        **flags('replace-origin replace-session-connection ICE=remove DTLS=off SDES-only-AES_CM_128_HMAC_SHA1_80 transport-protocol=RTP/SAVP direction=priv direction=pub')})
    expect_sdp(offer, 'RTP/SAVP')
    # Actual source forward reply flags must restore plain RTP toward FS.
    expect_sdp(send({'command': 'answer', 'call-id': call, 'from-tag': 'fs', 'to-tag': 'phone', 'sdp': secure, **flags(answer_flags[0])}), 'RTP/AVP')
    # Phone renegotiates the same call; FS receives plain RTP.
    expect_sdp(send({'command': 'offer', 'call-id': call, 'from-tag': 'phone', 'to-tag': 'fs', 'sdp': secure,
        **flags('replace-origin replace-session-connection ICE=remove DTLS=off SDES=off transport-protocol=RTP/AVP direction=pub direction=priv')}), 'RTP/AVP')
    # Actual source reverse reply must restore SRTP and a usable SDES key to phone.
    expect_sdp(send({'command': 'answer', 'call-id': call, 'from-tag': 'phone', 'to-tag': 'fs', 'sdp': plain, **flags(answer_flags[1])}), 'RTP/SAVP')
    send({'command': 'delete', 'call-id': call})
    print('PASS: real RTPengine preserves FS RTP / handset SDES-SRTP on initial answer and reverse re-INVITE answer')
finally:
    p.terminate()
    p.wait(timeout=5)
