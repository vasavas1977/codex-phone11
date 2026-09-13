import subprocess,time
p=subprocess.Popen(['kamailio','-DD','-E','-f','/work/tests/fixtures/phone11-recording-anchor/runtime.cfg'],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
try:
 time.sleep(1)
 if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
 subprocess.run(['python3','/work/tests/fixtures/phone11-recording-anchor/runtime.py'],check=True)
finally:
 p.terminate();p.wait(timeout=5)
