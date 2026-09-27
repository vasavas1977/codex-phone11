import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('migrate', Path(__file__).resolve().parents[1] / 'scripts/phone11-invitations-migrate.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.state = self.root / 'live-schema'
        self.sql = b'BEGIN; COMMIT;'
        self.h = Mock()
        self.h.CATALOG_SQL = 'catalog %(base)s'
        self.h.DOCKER = '/usr/bin/docker'
        def private(path):
            if not path.is_dir() or path.stat().st_mode & 0o777 != 0o700:
                raise RuntimeError('private_directory')
        self.h.private_directory.side_effect = private
        self.h.backup.return_value = 'backup-pin'
        self.h.digest_private_archive.return_value = 'backup-pin'
        self.h.write_receipt.side_effect = lambda p, data: p.write_text(json.dumps(data))
        self.h.live_json.return_value = {'invitations':True, 'events':True, 'column_count':16, 'index_count':3}
        self.h.catalog_hash.side_effect = [m.AFTER, m.BEFORE]
        for name, value in [('ROOT',self.root),('STATE',self.state),('SQL_SHA',m.digest(self.sql))]:
            p = patch.object(m, name, value); p.start(); self.addCleanup(p.stop)
        for name, value in [('load_helper',lambda:self.h),('preflight',lambda h,a:None),('protected',lambda p:self.sql if p==m.SQL else p.read_bytes())]:
            p = patch.object(m,name,value);p.start();self.addCleanup(p.stop)
        p=patch.object(m.os,'geteuid',return_value=0);p.start();self.addCleanup(p.stop)

    def test_prepare_creates_private_state_and_backup_before_receipt(self):
        m.run('prepare')
        self.assertEqual(self.state.stat().st_mode&0o777,0o700)
        self.h.backup.assert_called_once()
        self.assertTrue((self.state/'prepared.json').exists())
        self.h.command.assert_not_called()

    def test_apply_requires_backup_and_checks_postflight(self):
        m.run('prepare');m.run('apply')
        call=self.h.command.call_args.args[0]
        self.assertIn('statement_timeout=30000',call[5])
        self.assertIn('default_transaction_read_only=off',call[5])
        self.assertIn(self.sql.decode(),call)
        self.assertTrue((self.state/'applied.json').exists())

    def test_changed_backup_never_applies(self):
        m.run('prepare'); self.h.digest_private_archive.return_value='changed'
        with self.assertRaisesRegex(RuntimeError,'backup_pin'):m.run('apply')
        self.h.command.assert_not_called()

    def test_schema_postflight_failure_never_claims_success(self):
        m.run('prepare');self.h.live_json.return_value={'invitations':False}
        with self.assertRaisesRegex(RuntimeError,'postflight_schema'):m.run('apply')
        self.assertFalse((self.state/'applied.json').exists())
        self.h.command.assert_called_once()  # No compensating DROP or rollback.

    def test_stale_or_future_backup_never_applies(self):
        m.run('prepare')
        path=self.state/'prepared.json'
        receipt=json.loads(path.read_text())
        created=receipt['created_at_unix']
        for changed in [created-901, created+120]:
            receipt['created_at_unix']=changed
            path.write_text(json.dumps(receipt))
            with self.assertRaisesRegex(RuntimeError,'backup_age'):m.run('apply')
        self.h.command.assert_not_called()

if __name__=='__main__':unittest.main()
