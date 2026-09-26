"""Synthetic, loopback-only Kamailio 5.8 final-failure/TM runtime probe."""
import json
import re
import socket
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

CONFIG = Path('/work/tests/fixtures/phone11-voicemail-fallback-tm/runtime.cfg')
LOG = Path('/tmp/phone11-vm-tm-kamailio.log')
cases = {}
seen = {15061: {}, 15062: {}, 15063: {}}
lock = threading.Lock()


def header(packet, name):
    found = re.search(r'^' + re.escape(name) + r':\s*(.*)\r?$', packet, re.M | re.I)
    return found.group(1).strip() if found else ''


def sip_reply(request, status, reason):
    lines = [f'SIP/2.0 {status} {reason}']
    for key in ('Via', 'From', 'To', 'Call-ID', 'CSeq'):
        for value in re.findall(r'^' + key + r':\s*(.*)\r?$', request, re.M | re.I):
            value = value.strip()
            if key == 'To' and ';tag=' not in value:
                value += ';tag=fixture-callee'
            lines.append(f'{key}: {value}')
    if status == 200:
        lines.append('Contact: <sip:synthetic@127.0.0.1>')
    return ('\r\n'.join(lines) + '\r\nContent-Length: 0\r\n\r\n').encode()


def endpoint(port):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(('127.0.0.1', port))
    while True:
        raw, peer = sock.recvfrom(65535)
        packet = raw.decode(errors='replace')
        if packet.startswith('CANCEL '):
            sock.sendto(sip_reply(packet, 200, 'OK'), peer)
            continue
        if not packet.startswith('INVITE '):
            continue
        callid = header(packet, 'Call-ID')
        with lock:
            case = cases.get(callid)
            if case is None:
                continue
            branch = header(packet, 'Via').split('branch=')[-1].split(';')[0]
            seen[port].setdefault(callid, set()).add(branch)
            mode = case['callees'].get(port, 'timeout')
        if port == 15063:
            case['fs'].set()
            mode = 'answer'
        if mode == 'timeout':
            continue

        def answer(mode=mode, packet=packet, peer=peer):
            if mode == 'delay-answer':
                time.sleep(0.2)
            status, reason = (486, 'Busy Here') if mode == 'busy' else (200, 'OK')
            sock.sendto(sip_reply(packet, status, reason), peer)

        threading.Thread(target=answer, daemon=True).start()


class Authority(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        if self.path != '/authorize':
            self.send_error(404)
            return
        callid = self.rfile.read(int(self.headers['Content-Length'])).decode()
        with lock:
            case = cases.get(callid)
            if case:
                case['http_count'] += 1
                case['http'].set()
        if case is None or not case['release'].wait(5):
            self.send_error(503)
            return
        try:
            self.send_response(200)
            self.send_header('Content-Length', '2')
            self.end_headers()
            self.wfile.write(b'ok')
        except (BrokenPipeError, ConnectionResetError):
            pass


def request(callid, method='INVITE', fork=False, port=15064):
    extra = 'X-Fixture-Fork: yes\r\n' if fork else ''
    return (f'{method} sip:fixture@127.0.0.1 SIP/2.0\r\n'
            f'Via: SIP/2.0/UDP 127.0.0.1:{port};branch=z9hG4bK{callid}\r\n'
            'From: <sip:synthetic-caller@fixture.invalid>;tag=caller\r\n'
            'To: <sip:fixture@fixture.invalid>\r\n'
            f'Call-ID: {callid}\r\n'
            f'CSeq: 1 {method}\r\n'
            'Max-Forwards: 70\r\n'
            f'{extra}Content-Length: 0\r\n\r\n').encode()


def wait_for(predicate, seconds, explanation):
    until = time.monotonic() + seconds
    while not predicate():
        if time.monotonic() >= until:
            raise AssertionError(explanation)
        time.sleep(0.02)


def branch_count(callid):
    with lock:
        return len(seen[15063].get(callid, set()))


def scenario(name, callees, *, fork=False, cancel=None, late=False):
    callid = name + '-' + uuid.uuid4().hex[:10] + '@fixture.invalid'
    case = dict(callees=callees, http=threading.Event(), release=threading.Event(),
                fs=threading.Event(), http_count=0)
    with lock:
        cases[callid] = case
    caller = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    caller.bind(('127.0.0.1', 15064))
    caller.settimeout(0.1)
    try:
        caller.sendto(request(callid, fork=fork), ('127.0.0.1', 15060))
        if cancel == 'before-http':
            time.sleep(0.1)
            caller.sendto(request(callid, 'CANCEL'), ('127.0.0.1', 15060))
        elif cancel == 'during-http':
            assert case['http'].wait(2), 'failure-route authorization was not reached'
            caller.sendto(request(callid, 'CANCEL'), ('127.0.0.1', 15060))
            time.sleep(0.1)
            case['release'].set()
        elif late:
            assert case['http'].wait(2), 'failure-route authorization was not reached'
            time.sleep(1.4)  # beyond configured 1800 ms TM lifetime
            case['release'].set()
        elif callees.get(15061) == 'timeout':
            assert case['http'].wait(2), 'last-branch timeout did not suspend for HTTP'
            case['release'].set()

        if name == 'no-answer':
            assert case['fs'].wait(2), 'HTTP resume did not add FS branch'
            wait_for(lambda: branch_count(callid) == 1, 1, 'expected exactly one FS branch')
            assert case['http_count'] == 1, 'duplicate authorization request'
        else:
            time.sleep(0.6 if not late else 0.8)
            assert branch_count(callid) == 0, f'{name} unexpectedly reached FS'
            if name in ('busy-only', 'busy-then-answer', 'cancel-before-http'):
                assert case['http_count'] == 0, f'{name} unexpectedly authorized'
            else:
                assert case['http_count'] == 1, f'{name} missed one authorization'
    finally:
        caller.close()
    return {'scenario': name, 'result': 'pass', 'http_requests': case['http_count'],
            'fs_branches': branch_count(callid)}


def main():
    parsed = subprocess.run(['kamailio', '-c', '-f', str(CONFIG)], capture_output=True, text=True)
    if parsed.returncode:
        raise RuntimeError('Kamailio parser rejected fixture:\n' + parsed.stdout + parsed.stderr)
    http = ThreadingHTTPServer(('127.0.0.1', 18080), Authority)
    threading.Thread(target=http.serve_forever, daemon=True).start()
    for port in seen:
        threading.Thread(target=endpoint, args=(port,), daemon=True).start()
    with LOG.open('w+') as log:
        process = subprocess.Popen(['kamailio', '-DD', '-E', '-f', str(CONFIG)], stdout=log, stderr=log)
        try:
            probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            probe.bind(('127.0.0.1', 0))
            probe.settimeout(0.15)
            ready = request('ready@fixture.invalid', port=probe.getsockname()[1]).replace(b'INVITE ', b'OPTIONS ', 1).replace(b'CSeq: 1 INVITE', b'CSeq: 1 OPTIONS')
            until = time.monotonic() + 15
            while True:
                assert process.poll() is None, 'Kamailio stopped during startup'
                assert time.monotonic() < until, 'Kamailio listener did not become ready'
                probe.sendto(ready, ('127.0.0.1', 15060))
                try:
                    if b'200 Ready' in probe.recv(65535):
                        break
                except socket.timeout:
                    pass
            probe.close()
            results = [
                scenario('no-answer', {15061: 'timeout'}),
                scenario('cancel-before-http', {15061: 'timeout'}, cancel='before-http'),
                scenario('cancel-during-http', {15061: 'timeout'}, cancel='during-http'),
                scenario('late-http', {15061: 'timeout'}, late=True),
                scenario('busy-only', {15061: 'busy'}),
                scenario('busy-then-answer', {15061: 'busy', 15062: 'delay-answer'}, fork=True),
            ]
            print(json.dumps({'kamailio_parser': 'pass', 'runtime': results}, indent=2))
        finally:
            process.terminate()
            process.wait(timeout=5)
            http.shutdown()
            if LOG.exists():
                print(LOG.read_text()[-10000:])


if __name__ == '__main__':
    main()
