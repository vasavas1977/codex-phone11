"""Gated remote-REFER containment: SDK-created outgoing legs are never adopted."""
import pathlib
import subprocess
import tempfile
from test_warm import Pipe

NATIVE = pathlib.Path(__file__).resolve().parent

def run(binary, mode):
    pipe = Pipe(binary)
    init = pipe.command('v1 init')
    if mode == 'PHONE11_FAKE_NO_REDIRECT_CAPABILITY':
        assert not init['ok'] and 'warmTransfer' not in init
        pipe.finish(); return
    assert init.get('warmTransfer') == 'owned-two-call-v1'
    assert pipe.command('v1 provision\ninvalid.example\n1020\n1020\nfake-secret\nTLS')['ok']
    pipe.collect(lambda: any(r.get('state') == 'incoming' for r in pipe.rows))
    assert pipe.command('v1 answer 200')['ok']
    pipe.collect(lambda: any(r.get('state') == 'connected' for r in pipe.rows))
    assert pipe.warm('begin','1021'); pipe.phase('held_ready'); assert pipe.warm('continue')
    pipe.phase('focus_ready'); assert pipe.warm('focus'); pipe.phase('focused')
    pipe.warm('unmute') # The SDK can create its redirect leg synchronously here.
    pipe.collect(lambda: any(r.get('event') == 'unsupported_redirect' for r in pipe.rows))
    assert not pipe.command('v1 dial 1022')['ok']
    assert not pipe.warm('complete','12345678-1234-4234-8234-123456789abd')
    assert not pipe.command('v1 mute 200 0')['ok']
    assert not pipe.command('v1 hold 200 0')['ok']
    assert not pipe.command('v1 end 202')['ok'] # Never admit an arbitrary End ID.
    assert pipe.command('v1 end 201')['ok']
    assert pipe.command('v1 end 200')['ok'] == (mode != 'PHONE11_FAKE_WARM_REDIRECT_RETIRED')
    assert not any(r.get('callId') == '202' for r in pipe.rows)
    assert not any(r.get('phase') == 'ready' for r in pipe.rows)
    pipe.command('v1 shutdown'); pipe.child.stdin.close(); pipe.child.wait(timeout=3); pipe.reader.join(timeout=1); pipe.watchdog.cancel()
    assert pipe.child.returncode == 0
    evidence = pipe.child.stderr.read().strip()
    ambiguous = mode in ('PHONE11_FAKE_WARM_REDIRECT_OVERLAP','PHONE11_FAKE_WARM_REDIRECT_ZERO','PHONE11_FAKE_WARM_REDIRECT_RETIRED')
    hidden = ambiguous or mode == 'PHONE11_FAKE_WARM_REDIRECT_END_REFUSED'
    original_ended = mode != 'PHONE11_FAKE_WARM_REDIRECT_RETIRED'
    assert evidence == f'redirectBye={int(not ambiguous)} originalBye={int(original_ended)} consultBye=1 hiddenBeforeShutdown={int(hidden)}', evidence
    # Hidden-before-shutdown on ambiguity/refusal is deliberate: mandatory fatal
    # pipe retirement performs SDK shutdown instead of risking an owned dialog.
    assert 'private-refer-to' not in str(pipe.rows) + evidence

def main():
    with tempfile.TemporaryDirectory(prefix='phone11-redirect-') as directory:
        for mode in ('PHONE11_FAKE_WARM_REDIRECT','PHONE11_FAKE_WARM_REDIRECT_UNKNOWN','PHONE11_FAKE_WARM_REDIRECT_OVERLAP','PHONE11_FAKE_WARM_REDIRECT_ZERO','PHONE11_FAKE_WARM_REDIRECT_RETIRED','PHONE11_FAKE_WARM_REDIRECT_MUTE_REFUSED','PHONE11_FAKE_WARM_REDIRECT_END_REFUSED','PHONE11_FAKE_NO_REDIRECT_CAPABILITY'):
            binary = pathlib.Path(directory)/'helper'
            flags = ['-DPHONE11_DESKTOP_WARM_TRANSFER_SOURCE_ENABLED=1','-D'+mode]
            if mode != 'PHONE11_FAKE_NO_REDIRECT_CAPABILITY': flags.append('-DPHONE11_FAKE_WARM_REDIRECT')
            subprocess.run(['clang++','-std=c++17','-pthread','-I',str(NATIVE/'test'),*flags,str(NATIVE/'phone11_siprix_helper.cpp'),'-o',str(binary)],check=True,capture_output=True,text=True,timeout=30)
            run(binary,mode)
    print('Gated SDK redirect containment passed; no provider or BYE-delivery proof')
if __name__ == '__main__': main()
