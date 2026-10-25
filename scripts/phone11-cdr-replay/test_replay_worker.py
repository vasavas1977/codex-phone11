import dataclasses
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
import urllib.parse
from unittest.mock import patch

import replay_worker as r

UUID = '5f38611e-b4f7-4234-b2bf-6335804e9a73'
NAME = UUID + '.cdr.xml'
ACK = b'{"ok":true,"callRecordId":11,"callLegId":12}'

def payload(uuid=UUID, tenant='1', suffix='', extra=''):
    xml = ('<?xml version="1.0"?><cdr core-uuid="fixture"><variables><uuid>' + uuid +
           '</uuid><tenant_id>' + tenant + '</tenant_id><start_epoch>1</start_epoch>'
           '<answer_epoch>2</answer_epoch><end_epoch>3</end_epoch>' + extra +
           '</variables></cdr>' + suffix)
    return urllib.parse.quote(xml, safe='').encode()

class Crash(BaseException):
    pass

class ReplayTests(unittest.TestCase):
    def setUp(self):
        # Resolved path avoids macOS /var symlink; owned private leaf directories.
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.spool = self.root / 'spool'; self.spool.mkdir(mode=0o700)
        self.state = self.root / 'state'; self.state.mkdir(mode=0o700)
        self.raw = payload(); self.file = self.spool / NAME
        self.file.write_bytes(self.raw); self.file.chmod(0o644)
        self.calls = []
        self.transport = lambda body, timeout: (self.calls.append((body, timeout)) or (200, ACK))

    def tearDown(self):
        self.tmp.cleanup()

    def worker(self, **kw):
        args = dict(transport=self.transport, admit=lambda identity: True,
                    completion_proof=lambda identity, metadata: True,
                    uid=os.getuid(), limits=r.Limits(settle_seconds=0))
        args.update(kw)
        return r.Worker(str(self.spool), str(self.state), **args)

    def journal(self):
        return json.loads(next(p for p in self.state.glob('*.json') if p.name != 'scan-cursor.json').read_bytes())

    def test_ack_and_exact_duplicate_skip_preserve_original(self):
        before = self.file.stat()
        self.assertEqual(self.worker().run()['acknowledged'], 1)
        self.assertEqual(self.calls[0][0], b'cdr=' + self.raw)
        self.assertLessEqual(self.calls[0][1], 3)
        self.assertEqual(self.worker().run()['skippedAcknowledged'], 1)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.journal()['status'], 'ACK')
        self.assertEqual(self.file.read_bytes(), self.raw)
        self.assertEqual(r.frame(self.file.stat()), r.frame(before))
        self.assertEqual(self.journal()['identity']['sha256'], hashlib.sha256(self.raw).hexdigest())

    def test_admission_receives_exact_decoded_sip_identity_without_journal_change(self):
        self.raw = payload(extra='<sip_call_id>owned%40example.test</sip_call_id>')
        self.file.write_bytes(self.raw)
        seen = []; completed = []
        def admit(value):
            seen.append(dict(value))
            value['tenantId'] = 99
            return True
        worker = self.worker(admit=admit,
            completion_proof=lambda identity, _: completed.append(identity) or True)
        self.assertEqual(worker.run()['acknowledged'], 1)
        identity = r.parse_payload(self.raw, NAME, 524288)
        self.assertEqual(seen, [{**identity, 'sipCallId': 'owned@example.test'}])
        self.assertEqual(completed, [identity])
        self.assertEqual(self.journal()['identity'], identity)
        self.assertEqual(self.calls[0][0], b'cdr=' + self.raw)

    def test_missing_sip_is_explicit_and_can_be_denied_before_intent(self):
        seen = []
        def admit(value):
            seen.append(value)
            return value['sipCallId'] is not None
        self.assertEqual(self.worker(admit=admit).run()['retained'], 1)
        self.assertIsNone(seen[0]['sipCallId'])
        self.assertFalse(self.calls)
        self.assertFalse(list(self.state.glob('*.body')))
        self.assertFalse([p for p in self.state.glob('*.json') if p.name != 'scan-cursor.json'])

    def test_malformed_sip_never_reaches_admission(self):
        seen = []
        for value in ['x' * 513, 'bad%00id', 'bad%0Aid', 'bad%7Fid']:
            with self.subTest(value=value[:20]):
                self.file.write_bytes(payload(extra='<sip_call_id>' + value + '</sip_call_id>'))
                self.assertEqual(self.worker(admit=lambda value: seen.append(value) or True).run()['retained'], 1)
        self.assertFalse(seen)
        self.assertFalse(self.calls)

    def test_crash_after_http_before_ack_journal_never_redispatches(self):
        def crash(body, timeout):
            self.calls.append(body); raise Crash()
        with self.assertRaises(Crash): self.worker(transport=crash).run()
        self.assertEqual(self.journal()['status'], 'INTENT')
        self.assertEqual(self.worker().run()['blockedJournal'], 1)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.file.read_bytes(), self.raw)

    def test_500_retained_and_blocked(self):
        self.worker(transport=lambda *_: (500, b'failure')).run()
        self.assertEqual(self.journal()['status'], 'RETRY')
        self.assertEqual(self.worker().run()['blockedJournal'], 1)
        self.assertFalse(self.calls)

    def test_timeout_unknown_retained(self):
        def timeout(*_): raise TimeoutError('private diagnostic must not escape')
        self.worker(transport=timeout).run()
        self.assertEqual(self.journal()['status'], 'UNKNOWN')
        self.assertEqual(self.worker().run()['blockedJournal'], 1)

    def test_wrong_response_or_non200_never_ack(self):
        for status, body in [(201, ACK), (200,b'OK'),(200,b'{"ok":true}'),
                             (200,b'{"ok":true,"callRecordId":true,"callLegId":1}'),
                             (200,b'{"ok":false,"ok":true,"callRecordId":1,"callLegId":2}')]:
            with self.subTest(body=body): self.assertIsNone(r.decode_ack(status, body))

    def test_malformed_partial_wrong_uuid_and_tenant(self):
        for raw in [b'%ZZ',b'cdr='+self.raw,b'<cdr/>', payload(suffix='<'),
                    payload(uuid='00000000-0000-0000-0000-000000000000'),
                    payload(tenant='0'),payload(tenant='1.0'),payload(tenant='2147483648'),
                    payload(extra='<uuid>'+UUID+'</uuid>')]:
            self.file.write_bytes(raw)
            self.assertEqual(self.worker().run()['retained'], 1)
        self.assertFalse(self.calls); self.assertFalse(list(self.state.glob('*.body')))

    def test_symlink_hardlink_fifo_directory_refused(self):
        self.file.unlink(); target = self.root/'target'; target.write_bytes(self.raw)
        self.file.symlink_to(target); self.worker().run(); self.file.unlink()
        os.link(target,self.file); self.worker().run(); self.file.unlink()
        os.mkfifo(self.file); self.worker().run(); self.file.unlink()
        self.file.mkdir(); self.worker().run()
        self.assertFalse(self.calls)

    def test_wrong_owner_and_writable_file_refused(self):
        self.file.chmod(0o666); self.worker().run()
        self.assertFalse(self.calls)
        self.file.chmod(0o644)
        with patch.object(r.os, 'fstat', wraps=os.fstat) as method:
            # Dedicated direct parser does not substitute UID; actual defaultroot
            # custody is checked by configuring a deliberately mismatching UID.
            with self.assertRaises(r.Refused): self.worker(uid=os.getuid()+1).run()
            self.assertTrue(method.called)

    def test_changed_during_stability_check_retained(self):
        def change(_): self.file.write_bytes(self.raw+b'%20')
        self.worker(pause=change).run()
        self.assertFalse(self.calls); self.assertFalse(list(self.state.glob('*.body')))

    def test_changed_after_http_retains_intent_not_ack(self):
        def change(body, timeout): self.file.write_bytes(self.raw+b'%20'); return 200,ACK
        self.worker(transport=change).run()
        self.assertEqual(self.journal()['status'], 'INTENT')
        self.assertEqual(next(self.state.glob('*.body')).read_bytes(), self.raw)
        self.assertEqual(self.worker().run()['blockedJournal'], 0) # new digest requires fresh admission

    def test_completion_and_tenant_admission_required(self):
        for kw in [dict(admit=lambda _:False),dict(completion_proof=lambda *_:False)]:
            self.worker(**kw).run()
        self.assertFalse(self.calls); self.assertFalse(list(self.state.glob('*.body')))

    def test_terminal_xml_and_no_entity(self):
        for xml in ['<!DOCTYPE cdr [<!ENTITY x "a">]><cdr/>',
                    '<cdr><variables><uuid>'+UUID+'</uuid><tenant_id>1</tenant_id><start_epoch>1</start_epoch><end_epoch>0</end_epoch></variables></cdr>']:
            self.file.write_bytes(urllib.parse.quote(xml,safe='').encode())
            self.worker().run()
        self.assertFalse(self.calls)

    def test_single_flock_prevents_second_process_engine(self):
        lock = os.open(self.state/'worker.lock',os.O_CREAT|os.O_RDWR,0o600)
        try:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError): self.worker().run()
        finally: os.close(lock)
        self.assertFalse(self.calls)

    def test_private_paths_and_separate_state(self):
        self.spool.chmod(0o755)
        with self.assertRaises(r.Refused): self.worker().run()
        self.spool.chmod(0o700)
        alias=self.root/'alias'; alias.symlink_to(self.spool)
        with self.assertRaises(OSError): r.Directory(str(alias),os.getuid())
        with self.assertRaises(r.Refused): r.Worker(str(self.spool),str(self.spool/'nested'),self.transport,lambda _:True,lambda *_:True)

    def test_caps_scan_body_and_timeout(self):
        (self.spool/('a_'+NAME)).write_bytes(self.raw)
        result=self.worker(limits=r.Limits(entries=1,settle_seconds=0)).run()
        self.assertTrue(result['scanLimitReached']); self.assertEqual(len(self.calls),1)
        self.file.write_bytes(b'x'*1025)
        result=self.worker(limits=r.Limits(body_bytes=1024,settle_seconds=0)).run()
        self.assertGreaterEqual(result['retained'],1)

    def test_journal_fsync_before_http_and_after_ack(self):
        sync=[]; actual=os.fsync
        def fsync(fd): sync.append(fd); actual(fd)
        def check(body, timeout):
            self.assertEqual(self.journal()['status'],'INTENT')
            self.assertGreaterEqual(len(sync),4)
            return 200,ACK
        with patch.object(r.os,'fsync',side_effect=fsync): self.worker(transport=check).run()
        self.assertGreaterEqual(len(sync),6)
        self.assertEqual(self.journal()['status'],'ACK')

    def test_corrupt_or_symlink_journal_no_dispatch(self):
        self.worker().run(); journal=next(p for p in self.state.glob('*.json') if p.name != 'scan-cursor.json')
        journal.write_bytes(b'{'); self.calls.clear(); self.worker().run()
        self.assertFalse(self.calls)
        journal.unlink(); journal.symlink_to(self.root/'outside'); self.worker().run()
        self.assertFalse(self.calls)

    def test_fair_cursor_beyond_acknowledged_first_batch(self):
        self.file.unlink()
        for i in range(7):
            uuid = f'00000000-0000-4000-8000-{i:012d}'
            (self.spool/(uuid+'.cdr.xml')).write_bytes(payload(uuid=uuid))
        limits = r.Limits(entries=2,settle_seconds=0)
        for _ in range(4): self.worker(limits=limits).run()
        self.assertEqual(len(self.calls),7)
        self.assertEqual(len(list(self.state.glob('*.body'))),7)
        self.assertEqual(len(list(self.spool.iterdir())),7)
        for _ in range(4): self.worker(limits=limits).run()
        self.assertEqual(len(self.calls),7)

    def test_known_500_503_retry_backoff_then_ack(self):
        now=[100]; responses=[(500,b'error'),(503,b'unavailable'),(200,ACK)]
        def transport(body, timeout): self.calls.append(body); return responses.pop(0)
        args=dict(transport=transport,wallclock=lambda:now[0])
        self.worker(**args).run()
        self.assertEqual(self.journal()['attempts'],1)
        self.worker(**args).run(); self.assertEqual(len(self.calls),1)
        now[0]=130; self.worker(**args).run()
        self.assertEqual(self.journal()['attempts'],2)
        self.assertEqual(self.journal()['nextAttemptAt'],190)
        now[0]=190; self.worker(**args).run()
        self.assertEqual(self.journal()['status'],'ACK')
        self.assertEqual(len(self.calls),3)
        self.assertTrue(all(x == b'cdr='+self.raw for x in self.calls))

    def test_retry_cap_and_permanent_statuses(self):
        now=[100]; calls=[]
        def fail(*_): calls.append(1); return 500,b'error'
        for tick in (100,130,190,300,500):
            now[0]=tick; self.worker(transport=fail,wallclock=lambda:now[0]).run()
        self.assertEqual(len(calls),3); self.assertEqual(self.journal()['status'],'HTTP_FAILURE')
        for status in (400,401,403,404,504):
            with self.subTest(status=status):
                # Clear only self-owned test state between independent cases.
                for p in self.state.iterdir(): p.unlink()
                self.worker(transport=lambda *_:(status,b'error')).run()
                self.assertEqual(self.journal()['status'],'HTTP_FAILURE')
                self.assertEqual(self.worker().run()['blockedJournal'],1)

    def test_snapshot_immutable_and_missing_or_tampered_refuses(self):
        self.worker().run(); snapshot=next(self.state.glob('*.body'))
        self.assertEqual(snapshot.read_bytes(),self.raw)
        self.assertEqual(snapshot.stat().st_mode & 0o777,0o600)
        snapshot.write_bytes(b'tampered'); self.calls.clear(); self.worker().run()
        self.assertFalse(self.calls)
        snapshot.unlink(); self.worker().run(); self.assertFalse(self.calls)

    def test_snapshot_or_fsync_failure_never_posts(self):
        actual=os.fsync
        def fail(fd):
            # Fail payload fsync after lock/cursor syncs; original remains intact.
            if os.fstat(fd).st_size == len(self.raw): raise OSError('disk failure')
            actual(fd)
        with patch.object(r.os,'fsync',side_effect=fail): self.worker().run()
        self.assertFalse(self.calls); self.assertEqual(self.file.read_bytes(),self.raw)
        self.assertFalse([p for p in self.state.glob('*.json') if p.name!='scan-cursor.json'])

    def test_census_bound_refuses_without_transport(self):
        (self.spool/'extra').write_bytes(b'')
        with self.assertRaises(r.Refused):
            self.worker(limits=r.Limits(entries=1,census_entries=1,settle_seconds=0)).run()
        self.assertFalse(self.calls)

    def test_no_network_adapter_or_invocation(self):
        text=Path(r.__file__).read_text()
        for forbidden in ['import socket','import requests','HTTPConnection','urlopen(', '__main__']:
            self.assertNotIn(forbidden,text)

if __name__ == '__main__': unittest.main(verbosity=2)
