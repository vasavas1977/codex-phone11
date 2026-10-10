"""Owned two-call protocol regressions. Fake SDK only; no credentials/network/media."""
import json
import pathlib
import queue
import subprocess
import tempfile
import threading
import time

NATIVE = pathlib.Path(__file__).resolve().parent
REQUEST = '12345678-1234-4234-8234-123456789abc'
TRANSFER = '12345678-1234-4234-8234-123456789abd'

class Pipe:
    def __init__(self, binary):
        self.child = subprocess.Popen([str(binary)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.watchdog = threading.Timer(8, self.child.kill); self.watchdog.start()
        self.rows = []; self.queue = queue.Queue()
        def read():
            for line in self.child.stdout: self.queue.put(json.loads(line))
        self.reader = threading.Thread(target=read, daemon=True); self.reader.start()
    def collect(self, predicate):
        deadline = time.monotonic() + 2
        while not predicate(): self.rows.append(self.queue.get(timeout=max(.01, deadline-time.monotonic())))
    def command(self, line):
        before = sum('ok' in r for r in self.rows)
        self.child.stdin.write(line+'\n'); self.child.stdin.flush()
        self.collect(lambda: sum('ok' in r for r in self.rows) > before)
        return [r for r in self.rows if 'ok' in r][-1]
    def phase(self, phase):
        self.collect(lambda: any(r.get('phase') == phase for r in self.rows))
    def warm(self, operation, argument=''):
        return self.command(f'v1 warm {operation} 200 {REQUEST}'+(' '+argument if argument else ''))['ok']
    def finish(self):
        self.command('v1 shutdown'); self.child.stdin.close(); self.child.wait(timeout=3); self.reader.join(timeout=1)
        while not self.queue.empty(): self.rows.append(self.queue.get())
        self.watchdog.cancel()
        assert self.child.returncode == 0
        assert self.child.stderr.read() == ''
        assert 'fake-secret' not in json.dumps(self.rows)


def test(binary, mode='', enabled=True, cancel=False, sole=False, early_cancel=False):
    pipe = Pipe(binary)
    assert pipe.command('v1 init').get('warmTransfer') == ('owned-two-call-v1' if enabled else None)
    assert pipe.command('v1 provision\ninvalid.example\n1020\n1020\nfake-secret\nTLS')['ok']
    pipe.collect(lambda: any(r.get('state') == 'incoming' for r in pipe.rows))
    assert pipe.command('v1 answer 200')['ok']
    pipe.collect(lambda: any(r.get('state') == 'connected' for r in pipe.rows))
    assert pipe.warm('begin', '1021') == enabled
    if not enabled: pipe.finish(); return
    assert not pipe.warm('begin', '1022') # one attempt even before held
    assert not pipe.command(f'v1 warm continue 200 {TRANSFER}')['ok'] # wrong request
    if early_cancel:
        assert pipe.warm('cancel'); pipe.phase('return_ready')
    else:
        pipe.phase('held_ready')
        if mode == 'PHONE11_FAKE_WARM_INITIAL_MUTE_REFUSED_SYNC':
            assert not pipe.warm('continue'); pipe.phase('consultation_failed')
            assert not pipe.warm('focus'); assert not pipe.warm('unmute'); assert not pipe.warm('complete', TRANSFER)
            assert pipe.command('v1 end 201')['ok']; assert pipe.command('v1 end 200')['ok']; pipe.finish(); return
        assert pipe.warm('continue'); assert not pipe.warm('continue')
        pipe.phase('focus_ready')
        if mode == 'PHONE11_FAKE_WARM_FOCUS_REFUSED_SYNC':
            assert not pipe.warm('focus'); pipe.phase('consultation_failed')
            assert not pipe.warm('unmute'); assert not pipe.warm('complete', TRANSFER)
            assert not any(r.get('phase') in ('focused','ready') for r in pipe.rows)
            assert pipe.command('v1 end 201')['ok']; assert pipe.command('v1 end 200')['ok']; pipe.finish(); return
        assert pipe.warm('focus')
        if mode == 'PHONE11_FAKE_WARM_FOCUS_DROP':
            assert not pipe.warm('complete', TRANSFER); assert pipe.command('v1 end 201')['ok']; pipe.finish(); return
        pipe.phase('focused')
        if mode == 'PHONE11_FAKE_WARM_UNMUTE_REFUSED_SYNC':
            assert not pipe.warm('unmute'); pipe.phase('consultation_failed'); assert not pipe.warm('complete', TRANSFER)
            assert not any(r.get('phase') == 'ready' for r in pipe.rows)
            assert pipe.command('v1 end 201')['ok']; assert pipe.command('v1 end 200')['ok']; pipe.finish(); return
        assert pipe.warm('unmute'); pipe.phase('ready')
        assert not pipe.command('v1 dial 1022')['ok']
        assert not pipe.command('v1 hold 200 0')['ok']
        if sole:
            assert pipe.command('v1 end 200')['ok']; pipe.phase('original_ended')
            assert not pipe.warm('complete', TRANSFER)
            assert not pipe.command('v1 dial 1022')['ok']
            assert pipe.command('v1 end 201')['ok']; pipe.phase('ended')
            assert not pipe.command('v1 end 201')['ok']; pipe.finish(); return
        if not cancel:
            result = pipe.warm('complete', TRANSFER)
            assert result == (mode not in ('PHONE11_FAKE_WARM_TRANSFER_REFUSED','PHONE11_FAKE_WARM_TRANSFER_REFUSED_SYNC'))
            assert not pipe.warm('complete', TRANSFER)
            if mode == 'PHONE11_FAKE_WARM_TRANSFER_REFUSED_SYNC':
                pipe.phase('uncertain'); assert not pipe.warm('cancel')
                assert not any(r.get('phase') == 'completed' for r in pipe.rows)
                assert pipe.command('v1 end 201')['ok']; assert pipe.command('v1 end 200')['ok']; pipe.finish(); return
            if mode == 'PHONE11_FAKE_WARM_TRANSFER_DROP':
                assert not pipe.warm('cancel'); assert pipe.command('v1 end 201')['ok']; assert pipe.command('v1 end 200')['ok']; pipe.finish(); return
            pipe.phase('transfer_failed' if mode in ('PHONE11_FAKE_WARM_TRANSFER_FAILED', 'PHONE11_FAKE_WARM_TRANSFER_REFUSED','PHONE11_FAKE_WARM_TRANSFER_REFUSED_SYNC') else 'completed')
            if mode not in ('PHONE11_FAKE_WARM_TRANSFER_FAILED', 'PHONE11_FAKE_WARM_TRANSFER_REFUSED','PHONE11_FAKE_WARM_TRANSFER_REFUSED_SYNC'):
                assert not pipe.warm('cancel'); assert pipe.command('v1 end 201')['ok']; assert pipe.command('v1 end 200')['ok']; pipe.finish(); return
        if mode == 'PHONE11_FAKE_WARM_END_REFUSED':
            assert not pipe.warm('cancel'); assert pipe.warm('cancel') # pre-acceptance cancellation refusal permits explicit retry
        else: assert pipe.warm('cancel')
        pipe.phase('return_ready')
    assert pipe.warm('restore'); pipe.phase('returning');
    # A local resume callback is required before asking for focus restoration.
    start = len(pipe.rows)
    pipe.collect(lambda: any(r.get('phase') == 'return_audio_ready' for r in pipe.rows[start:]))
    if mode == 'PHONE11_FAKE_WARM_RESTORE_REFUSED_SYNC':
        assert not pipe.warm('restore'); pipe.phase('return_failed')
        assert not any(r.get('phase') == 'returned' for r in pipe.rows)
        assert pipe.command('v1 end 200')['ok']; pipe.finish(); return
    assert pipe.warm('restore'); pipe.phase('returned')
    if mode == 'PHONE11_FAKE_WARM_REMOTE_HOLD': assert [r for r in pipe.rows if r.get('event') == 'call' and r.get('callId') == '200'][-1]['state'] == 'held'
    assert not pipe.warm('begin', '1022')
    assert pipe.command('v1 end 200')['ok']; pipe.finish()


def main():
    with tempfile.TemporaryDirectory(prefix='phone11-warm-') as directory:
        for mode, enabled in [('',False),('',True),('PHONE11_FAKE_WARM_INVITE_SYNC',True),('PHONE11_FAKE_WARM_INITIAL_MUTE_REFUSED_SYNC',True),('PHONE11_FAKE_WARM_FOCUS_REFUSED_SYNC',True),('PHONE11_FAKE_WARM_UNMUTE_REFUSED_SYNC',True),('PHONE11_FAKE_WARM_TRANSFER_REFUSED_SYNC',True),('PHONE11_FAKE_WARM_RESTORE_REFUSED_SYNC',True),('PHONE11_FAKE_WARM_REMOTE_HOLD',True),('PHONE11_FAKE_WARM_TRANSFER_FAILED',True),('PHONE11_FAKE_WARM_TRANSFER_REFUSED',True),('PHONE11_FAKE_WARM_TRANSFER_DROP',True),('PHONE11_FAKE_WARM_FOCUS_DROP',True),('PHONE11_FAKE_WARM_END_REFUSED',True)]:
            binary = pathlib.Path(directory)/'helper'
            subprocess.run(['clang++','-std=c++17','-pthread','-I',str(NATIVE/'test'),f'-DPHONE11_DESKTOP_WARM_TRANSFER_SOURCE_ENABLED={int(enabled)}',*(['-D'+mode] if mode else []),str(NATIVE/'phone11_siprix_helper.cpp'),'-o',str(binary)],check=True,capture_output=True,text=True,timeout=30)
            test(binary,mode,enabled,cancel=mode in ('PHONE11_FAKE_WARM_END_REFUSED','PHONE11_FAKE_WARM_RESTORE_REFUSED_SYNC','PHONE11_FAKE_WARM_REMOTE_HOLD'))
            if enabled and not mode:
                test(binary,cancel=True); test(binary,sole=True); test(binary,early_cancel=True)
    print('Owned desktop warm source protocol passed; no provider or audio proof')
if __name__ == '__main__': main()
