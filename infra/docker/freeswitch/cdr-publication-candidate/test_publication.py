import hashlib,importlib.util,json,os,platform,stat,subprocess,tempfile,unittest
from pathlib import Path
P=Path(__file__).resolve().parent;FINAL='00000000-0000-4000-8000-000000000001.cdr.xml';PENDING='.'+FINAL+'.nonce.pending';BODY=b'%3Ccdr%3E%3Cvariables%3E%3Cuuid%3E00000000-0000-4000-8000-000000000001%3C%2Fuuid%3E%3C%2Fvariables%3E%3C%2Fcdr%3E'
class Publication(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.build=tempfile.TemporaryDirectory(prefix='p11-cdr-cc-');cls.exe=Path(cls.build.name)/'faults';subprocess.run(['/usr/bin/cc','-std=c99','-Wall','-Wextra','-Werror','-I',str(P),str(P/'fault_driver.c'),'-o',str(cls.exe)],capture_output=True,check=True,timeout=15)
 @classmethod
 def tearDownClass(cls):cls.build.cleanup()
 def invoke(self,fault,setup=None,code=0):
  with tempfile.TemporaryDirectory(prefix='p11-cdr-pub-')as name:
   p=Path(name);p.chmod(0o700)
   if setup:setup(p)
   r=subprocess.run([str(self.exe),str(p),fault],capture_output=True,timeout=5);self.assertEqual(r.returncode,code);value=json.loads(r.stdout)if code==0 else None
   files={f.name:('symlink'if f.is_symlink()else f.read_bytes())for f in p.iterdir()}
   for f in p.iterdir():
    if f.name!=FINAL and f.name!=PENDING:continue
    if not f.is_symlink():self.assertEqual(stat.S_IMODE(f.stat().st_mode),0o600);self.assertEqual(f.stat().st_nlink,1)
   return value,files
 def test_complete_and_short_and_eintr(self):
  for fault in ['none','short','eintr']:
   with self.subTest(fault=fault):v,f=self.invoke(fault);self.assertEqual(v['publication'],0);self.assertEqual(f,{FINAL:BODY})
 def test_write_zero_and_sync_failures_retain_only_pending(self):
  for fault in ['write','zero','file-fsync']:
   with self.subTest(fault=fault):v,f=self.invoke(fault);self.assertEqual(v['publication'],1);self.assertIn(PENDING,f);self.assertNotIn(FINAL,f);self.assertTrue(BODY.startswith(f[PENDING]))
 def test_close_and_rename_uncertain_preserve_full_pending(self):
  for fault in ['close','rename']:
   with self.subTest(fault=fault):v,f=self.invoke(fault);self.assertEqual(v['publication'],2);self.assertEqual(f,{PENDING:BODY})
 def test_directory_fsync_failure_preserves_published_body_unknown(self):
  v,f=self.invoke('dir-fsync');self.assertEqual(v['publication'],2);self.assertEqual(f,{FINAL:BODY})
 def test_existing_final_is_never_rewritten(self):
  def setup(p):(p/FINAL).write_bytes(b'old-completed');(p/FINAL).chmod(0o600)
  v,f=self.invoke('none',setup);self.assertEqual(v['publication'],2);self.assertEqual(f[FINAL],b'old-completed');self.assertEqual(f[PENDING],BODY)
 def test_existing_pending_is_never_rewritten(self):
  def setup(p):(p/PENDING).write_bytes(b'old-uncertain');(p/PENDING).chmod(0o600)
  v,f=self.invoke('none',setup);self.assertEqual(v['publication'],1);self.assertEqual(f,{PENDING:b'old-uncertain'})
 def test_symlink_final_and_unsafe_parent(self):
  def symlink(p):(p/'target').write_bytes(b'original');(p/FINAL).symlink_to('target')
  v,f=self.invoke('none',symlink);self.assertEqual(v['publication'],2);self.assertEqual(f[FINAL],'symlink');self.assertEqual(f['target'],b'original');self.assertEqual(f[PENDING],BODY)
  v,f=self.invoke('none',lambda p:p.chmod(0o755));self.assertEqual(v['publication'],1);self.assertEqual(f,{})
 def test_pending_symlink_and_hardlink_are_not_opened(self):
  for kind in ['symlink','hardlink']:
   def setup(p):
    (p/'target').write_bytes(b'old-uncertain')
    if kind=='symlink':(p/PENDING).symlink_to('target')
    else:os.link(p/'target',p/PENDING)
   with self.subTest(kind=kind):
    with tempfile.TemporaryDirectory(prefix='p11-cdr-collision-')as name:
     p=Path(name);p.chmod(0o700);setup(p);r=subprocess.run([str(self.exe),str(p),'none'],capture_output=True,timeout=5);self.assertEqual(r.returncode,0);self.assertEqual(json.loads(r.stdout)['publication'],1);self.assertEqual((p/'target').read_bytes(),b'old-uncertain');self.assertFalse((p/FINAL).exists());self.assertTrue((p/PENDING).is_symlink()if kind=='symlink'else(p/PENDING).stat().st_nlink==2)
 def test_process_crash_preserves_pending_or_final(self):
  _,f=self.invoke('crash-after-file-sync',code=81);self.assertEqual(f,{PENDING:BODY});_,f=self.invoke('crash-after-rename',code=82);self.assertEqual(f,{FINAL:BODY})
 def test_upstream_pin_patch_and_opt_in_only(self):
  spec=importlib.util.spec_from_file_location('derive',P/'derive.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);old,new=m.candidate();self.assertEqual(hashlib.sha256(old).hexdigest(),m.SHA);self.assertEqual(new,(P/'candidate-mod_xml_cdr.c').read_bytes());s=new.decode();self.assertIn('if (globals.completed_err_log_dir)',s);self.assertIn('goto error;',s);self.assertIn('error-completed-dir',s);self.assertEqual(s.count('O_WRONLY | O_CREAT | O_TRUNC'),4);self.assertNotIn('replay_worker',s)
if __name__=='__main__':unittest.main()
