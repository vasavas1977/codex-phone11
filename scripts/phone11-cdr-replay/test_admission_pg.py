"""Real owned Unix-socket PG16/17 SELECT semantics; never Docker or production.

Only the admission query's column/type/nullability projection is embedded from
a pinned PG16 metadata capture (CATALOG_SHA). Constraints/triggers/full archive/TLS are not tested.
"""
import hashlib, importlib.util, json, os, re, shutil, subprocess, tempfile, unittest
from pathlib import Path

P = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('phone11_owned_admission', P / 'admission.py')
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)
# Metadata-only PG16 capture, not a restored archive or business schema.
CATALOG_SHA = '43e02423894d396c2fe24da5e098ceff4183877cad0868bfed383f31e142b541'
SCHEMA_PROJECTION = 'CREATE TABLE public.tenants(id integer NOT NULL,status varchar NOT NULL);\nCREATE TABLE public.extensions(id integer NOT NULL,tenant_id integer NOT NULL,status varchar NOT NULL,deleted_at timestamptz);\nCREATE TABLE public.phone11_recording_routes(channel_uuid uuid NOT NULL,tenant_id integer NOT NULL,extension_id integer NOT NULL,sip_call_id text);\nCREATE TABLE public.phone11_recording_wake_links(tenant_id integer NOT NULL,extension_id integer NOT NULL,sip_call_id text NOT NULL);\nCREATE TABLE public.call_records(call_uuid text NOT NULL,tenant_id integer NOT NULL);\nCREATE TABLE public.call_legs(leg_uuid text NOT NULL,tenant_id integer NOT NULL);\n'
COLUMNS = ['tenants', 'extensions', 'phone11_recording_routes',
           'phone11_recording_wake_links', 'call_records', 'call_legs']
BIN = None
U = '61c24a78-cf7b-4564-8dac-e2bec9baf9b0'
T = 2147483510
IDENTITY = {'uuid': U, 'tenantId': T, 'sha256': 'a' * 64, 'sipCallId': "owned'cdr@example.invalid"}

def captured_schema():
    return SCHEMA_PROJECTION

class AdmissionPG(unittest.TestCase):
    @classmethod
    def command(cls, name, args, **kw):
        return subprocess.run([str(BIN / name), *args], capture_output=True, text=True, timeout=40, **kw)

    @classmethod
    def cleanup(cls):
        if cls.started:
            p = cls.command('pg_ctl', ['-D', str(cls.data), '-m', 'fast', '-w', 'stop'])
            if p.returncode != 0:
                raise RuntimeError('OWNED_PG_STOP_UNCONFIRMED_RETAINED')
            cls.started = False
            if cls.command('pg_ctl', ['-D', str(cls.data), 'status']).returncode != 3:
                raise RuntimeError('OWNED_PG_EXIT_UNCONFIRMED_RETAINED')
        shutil.rmtree(cls.root)
        cls.removed = True

    @classmethod
    def setUpClass(cls):
        global BIN
        configured = os.environ.get('PHONE11_REPLAY_PG_BIN')
        ctl = shutil.which('pg_ctl')
        BIN = Path(configured) if configured else (Path(ctl).resolve().parent if ctl else None)
        if BIN is None or any(not (BIN / name).is_file() for name in ['postgres', 'initdb', 'pg_ctl', 'psql']):
            raise unittest.SkipTest('Local PostgreSQL tools unavailable; set PHONE11_REPLAY_PG_BIN to an existing PG16/17 bin directory')
        version = cls.command('postgres', ['--version'])
        if version.returncode or not re.search(r'PostgreSQL\) (16|17)\.', version.stdout):
            raise unittest.SkipTest('This typed SQL fixture is qualified for local PostgreSQL16/17 only')
        if hasattr(os, 'geteuid') and os.geteuid() == 0:
            raise unittest.SkipTest('initdb requires a non-root owner for the disposable local cluster')
        cls.root = Path(tempfile.mkdtemp(prefix='p11-admission-pg-', dir='/tmp'))
        os.chmod(cls.root, 0o700)
        cls.data = cls.root / 'data'
        cls.sock = cls.root / 'socket'
        cls.sock.mkdir(mode=0o700)
        cls.started = cls.removed = False
        cls.addClassCleanup(cls.cleanup)
        cls.command('initdb', ['-D', str(cls.data), '-U', 'owned_admission', '--auth-local=trust', '--auth-host=reject', '--no-locale', '-E', 'UTF8']).check_returncode()
        cls.started = True
        cls.command('pg_ctl', ['-D', str(cls.data), '-l', str(cls.root / 'pg.log'), '-o', "-h '' -k " + str(cls.sock) + ' -p 55439', '-w', 'start']).check_returncode()
        cls.sql(captured_schema() + '\nCREATE ROLE owned_reader NOLOGIN; GRANT USAGE ON SCHEMA public TO owned_reader; GRANT SELECT ON ALL TABLES IN SCHEMA public TO owned_reader;').check_returncode()

    @classmethod
    def sql(cls, text):
        return cls.command('psql', ['-X', '-w', '-q', '-h', str(cls.sock), '-p', '55439', '-U', 'owned_admission', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate'], input=text)

    def setUp(self):
        self.sql('TRUNCATE ' + ','.join('public.' + n for n in COLUMNS) + '; INSERT INTO tenants VALUES(' + str(T) + ",'active'),(" + str(T + 1) + ",'active'); INSERT INTO extensions VALUES(" + str(T) + ',' + str(T) + ",'active',NULL),(" + str(T + 1) + ',' + str(T) + ",'active',NULL);").check_returncode()

    def run_query(self, identity=None):
        p = self.sql('SET ROLE owned_reader;\n' + a.admission_sql(identity or IDENTITY))
        self.assertEqual(p.returncode, 0, p.stderr)
        value = json.loads(p.stdout.strip())
        self.assertEqual(set(value), {'admitted'})
        self.assertIs(type(value['admitted']), bool)
        return value['admitted']

    def direct(self, sip=None):
        sip = IDENTITY['sipCallId'] if sip is None else sip
        literal = "'" + sip.replace("'", "''") + "'"
        self.sql("INSERT INTO phone11_recording_routes VALUES('" + U + "'," + str(T) + ',' + str(T) + ',' + literal + ');').check_returncode()

    def wake(self, extension, sip=None):
        sip = IDENTITY['sipCallId'] if sip is None else sip
        self.sql('INSERT INTO phone11_recording_wake_links VALUES(' + str(T) + ',' + str(extension) + ",'" + sip.replace("'", "''") + "');").check_returncode()

    def test_01_v1_reproduces_42703_v2_exact_single_column_fix(self):
        self.assertEqual(hashlib.sha256((P / 'admission.py').read_bytes()).hexdigest(),
                         '91c8353b78816825a4010bbf0bd59f7e18293a321e6c94252c9116d274998950')
        query = a.admission_sql(IDENTITY)
        self.assertEqual(query.count('l.leg_uuid::text'), 1)
        p = self.sql(query.replace('l.leg_uuid::text', 'l.call_uuid::text'))
        self.assertEqual(p.returncode, 3)
        self.assertRegex(p.stderr, r'ERROR:\s+42703\b')
        self.assertFalse(self.run_query())

    def test_02_direct_exact_identity_sip_and_tenant(self):
        self.direct()
        self.assertTrue(self.run_query())
        for delta in [{'tenantId': T + 1}, {'tenantId': T + 9}, {'sipCallId': 'wrong'}, {'sipCallId': None}]:
            with self.subTest(delta=delta): self.assertFalse(self.run_query({**IDENTITY, **delta}))
        self.sql("UPDATE phone11_recording_routes SET sip_call_id='';").check_returncode()
        self.assertTrue(self.run_query({**IDENTITY, 'sipCallId': None}))

    def test_03_wake_unique_ambiguous_and_direct_priority(self):
        self.wake(T)
        self.assertTrue(self.run_query())
        self.assertFalse(self.run_query({**IDENTITY, 'sipCallId': 'wrong'}))
        self.assertFalse(self.run_query({**IDENTITY, 'tenantId': T + 1}))
        self.wake(T)  # duplicate identical binding still one DISTINCT authority
        self.assertTrue(self.run_query())
        self.wake(T + 1)
        self.assertFalse(self.run_query())
        self.direct()
        self.assertTrue(self.run_query())  # trusted direct route takes priority

    def test_04_inactive_deleted_missing_and_collision_refusals(self):
        self.direct()
        for statement in ["UPDATE extensions SET status='inactive'", 'UPDATE extensions SET deleted_at=now()', 'DELETE FROM extensions', "UPDATE tenants SET status='inactive'"]:
            with self.subTest(statement=statement):
                # Each psql session is independent; reset exact synthetic graph.
                self.setUp(); self.direct(); self.sql(statement + ';').check_returncode()
                self.assertFalse(self.run_query())
        for table, field in [('call_records', 'call_uuid'), ('call_legs', 'leg_uuid')]:
            self.setUp(); self.direct()
            self.sql('INSERT INTO ' + table + '(' + field + ",tenant_id) VALUES('" + U + "'," + str(T + 1) + ');').check_returncode()
            self.assertFalse(self.run_query())
            self.sql('UPDATE ' + table + ' SET tenant_id=' + str(T) + ';').check_returncode()
            self.assertTrue(self.run_query())

    def test_05_missing_role_and_select_permissions(self):
        self.direct()
        p = self.sql('SET ROLE never_created_owned_role;' + a.admission_sql(IDENTITY))
        self.assertEqual(p.returncode, 3); self.assertRegex(p.stderr, r'ERROR:\s+22023\b')
        self.sql('REVOKE SELECT ON public.call_legs FROM owned_reader;').check_returncode()
        try:
            p = self.sql('SET ROLE owned_reader;' + a.admission_sql(IDENTITY))
            self.assertEqual(p.returncode, 3); self.assertRegex(p.stderr, r'ERROR:\s+42501\b')
        finally: self.sql('GRANT SELECT ON public.call_legs TO owned_reader;').check_returncode()

    def test_06_inactive_direct_cannot_fall_back_and_input_is_not_sql(self):
        self.direct(); self.wake(T + 1)
        self.sql('UPDATE extensions SET deleted_at=now() WHERE id=' + str(T) + ';').check_returncode()
        self.assertFalse(self.run_query())  # positive wake cannot downgrade known inactive direct
        self.sql('DELETE FROM phone11_recording_routes;').check_returncode()
        self.assertTrue(self.run_query())
        self.sql('UPDATE extensions SET tenant_id=' + str(T + 1) + ' WHERE id=' + str(T + 1) + ';').check_returncode()
        self.assertFalse(self.run_query())  # wake link and extension tenant must match
        for delta in [{'tenantId': True}, {'sipCallId': 'bad\ncall'}, {'uuid': 'not-uuid'}, {'sha256': 'x'}]:
            with self.subTest(delta=delta), self.assertRaises(a.AdmissionRefused): a.admission_sql({**IDENTITY, **delta})

if __name__ == '__main__': unittest.main()
