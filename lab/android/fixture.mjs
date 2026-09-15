import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lab = path.join(root, '.lab');
const metadata = path.join(lab, 'fixture.json');
const owner = createHash('sha256').update(root).digest('hex').slice(0, 16);
const label = 'com.phone11.android-lab.owner';
const image = `phone11-android-lab-pbx:${owner}`;
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const privateWrite = (file, data) => { fs.writeFileSync(file, data, { mode: 0o600 }); fs.chmodSync(file, 0o600); };

export function configs(accounts) {
  // Random local credentials use 24-byte hex; the commissioned staging seed
  // uses 32-byte base64url. Keep the accepted formats exact so configuration
  // generation cannot become a general string-injection path.
  for (const id of ['7101', '7102']) if (!/^(?:[a-f0-9]{48}|[A-Za-z0-9_-]{43})$/.test(accounts[id]?.password || '')) throw new Error('Invalid fixture password');
  const endpoint = id => `[${id}]\ntype=endpoint\ncontext=lab\ndisallow=all\nallow=ulaw,alaw\nauth=${id}-auth\naors=${id}\ndirect_media=no\nforce_rport=yes\nrewrite_contact=yes\nrtp_symmetric=yes\nmedia_address=10.0.2.2\ncallerid=Lab ${id} <${id}>\n\n[${id}-auth]\ntype=auth\nauth_type=userpass\nusername=${id}\npassword=${accounts[id].password}\n\n[${id}]\ntype=aor\nmax_contacts=1\nremove_existing=yes\nqualify_frequency=0\n`;
  return {
    'asterisk.conf': `[directories]\nastetcdir => /etc/asterisk\nastmoddir => /usr/lib/asterisk/modules\nastvarlibdir => /var/lib/asterisk\nastdbdir => /var/lib/asterisk\nastkeydir => /var/lib/asterisk\nastdatadir => /var/lib/asterisk\nastagidir => /var/lib/asterisk/agi-bin\nastspooldir => /var/spool/asterisk\nastrundir => /var/run/asterisk\nastlogdir => /var/log/asterisk\n[options]\nverbose=0\ndebug=0\n` ,
    'pjsip.conf': `[global]\ntype=global\nendpoint_identifier_order=username\n[transport-udp]\ntype=transport\nprotocol=udp\nbind=0.0.0.0:15060\n[transport-tcp]\ntype=transport\nprotocol=tcp\nbind=0.0.0.0:15060\n\n${endpoint('7101')}\n${endpoint('7102')}`,
    'extensions.conf': `[general]\nstatic=yes\nwriteprotect=yes\n[lab]\nexten => 7101,1,Set(TIMEOUT(absolute)=20)\n same => n,Dial(PJSIP/7101,20)\n same => n,Hangup()\nexten => 7102,1,Set(TIMEOUT(absolute)=20)\n same => n,Dial(PJSIP/7102,20)\n same => n,Hangup()\nexten => 7190,1,Answer()\n same => n,Set(TIMEOUT(absolute)=20)\n same => n,PlayTones(440)\n same => n,Wait(20)\n same => n,Hangup()\nexten => 7191,1,Answer()\n same => n,Set(TIMEOUT(absolute)=20)\n same => n,Echo()\n same => n,Hangup()\n`,
    'rtp.conf': `[general]\nrtpstart=16000\nrtpend=16019\nicesupport=no\nstrictrtp=yes\n`,
    'modules.conf': `[modules]\nautoload=yes\nnoload=chan_sip.so\nnoload=chan_iax2.so\nnoload=chan_skinny.so\nnoload=chan_mgcp.so\nnoload=chan_unistim.so\nnoload=res_http_websocket.so\nnoload=res_pjsip_transport_websocket.so\nnoload=res_ari.so\nnoload=res_manager_devicestate.so\nnoload=pbx_dundi.so\nnoload=res_pjsip_outbound_registration.so\n`,
    'manager.conf': `[general]\nenabled=no\n`,
    'http.conf': `[general]\nenabled=no\n`,
    'logger.conf': `[general]\n[logfiles]\nconsole=error\n`,
    'cdr.conf': `[general]\nenable=no\n`,
    'cel.conf': `[general]\nenable=no\n`,
  };
}

export function validateState(state) {
  if (state.owner !== owner || !/^[a-f0-9]{16}$/.test(state.runId || '') || state.container !== `phone11-lab-${owner}-${state.runId}` || state.network !== `${state.container}-net` || state.configDir !== path.join(lab, `pbx-${state.runId}`)) throw new Error('Fixture ownership mismatch');
  return state;
}
const stateRead = () => validateState(JSON.parse(fs.readFileSync(metadata, 'utf8')));
function inspect(kind, name) {
  try { return JSON.parse(docker([kind, 'inspect', name]))[0]; }
  catch (error) { if (/No such|not found/.test(String(error.stderr))) return null; throw error; }
}
function assertOwned(kind, name, state) {
  const value = inspect(kind, name);
  if (value && ((value.Config?.Labels || value.Labels)?.[label] !== owner || (value.Config?.Labels || value.Labels)?.['com.phone11.android-lab.run'] !== state.runId)) throw new Error('Refusing unrelated Docker resource');
  return value;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function validateRuntime(container, network) {
  const bindings = container?.HostConfig?.PortBindings || {};
  const expected = ['15060/tcp', '15060/udp', ...Array.from({ length: 20 }, (_, i) => `${16000 + i}/udp`)];
  const effective = container?.NetworkSettings?.Ports || {};
  if (network?.Driver !== 'bridge' || Object.keys(bindings).length !== expected.length || !expected.every(port => [bindings, effective].every(map => map[port]?.length === 1 && map[port][0].HostIp === '127.0.0.1' && map[port][0].HostPort === port.split('/')[0])) || !container.HostConfig.ReadonlyRootfs || container.HostConfig.Privileged) throw new Error('Fixture isolation check failed');
}
async function check(state) {
  validateRuntime(assertOwned('container', state.container, state), assertOwned('network', state.network, state));
  for (let i = 0; i < 20; i++) {
    try {
      const endpoints = docker(['exec', state.container, 'asterisk', '-rx', 'pjsip show endpoints']);
      const tone = docker(['exec', state.container, 'asterisk', '-rx', 'dialplan show 7190@lab']);
      if (/7101/.test(endpoints) && /7102/.test(endpoints) && /PlayTones/.test(tone)) {
        const firewall = docker(['exec', state.container, 'cat', '/tmp/phone11-firewall.txt']);
        const processStatus = docker(['exec', state.container, 'cat', '/proc/1/status']);
        if (!firewall.includes('-P OUTPUT DROP') || !/CapEff:\s+0+\n/.test(processStatus) || !/CapBnd:\s+0+\n/.test(processStatus)) throw new Error('Fixture isolation check failed');
        const version = docker(['exec', state.container, 'asterisk', '-rx', 'core show version']).split('\n')[0];
        const evidence = { at: new Date().toISOString(), status: 'PASS', scope: 'PBX readiness only; not Android registration or audible media', runId: state.runId, version, imageId: state.imageId, checks: ['7101 and 7102 configured', '7190 tone dialplan loaded', 'loopback SIP 15060 and RTP 16000-16019'], sip: state.sip, rtp: state.rtp };
        privateWrite(path.join(lab, 'fixture-check.json'), JSON.stringify(evidence, null, 2));
        return evidence;
      }
    } catch {}
    await sleep(500);
  }
  throw new Error('PBX readiness failed');
}
async function up() {
  fs.mkdirSync(lab, { recursive: true, mode: 0o700 }); fs.chmodSync(lab, 0o700);
  if (!fs.existsSync(metadata)) {
    const runId = randomBytes(8).toString('hex');
    const container = `phone11-lab-${owner}-${runId}`;
    const state = { owner, runId, container, network: `${container}-net`, configDir: path.join(lab, `pbx-${runId}`), createdAt: new Date().toISOString(), sip: { host: '10.0.2.2', port: 15060, transport: 'udp' }, rtp: { start: 16000, end: 16019 }, accounts: Object.fromEntries(['7101','7102'].map(username => [username, { username, password: randomBytes(24).toString('hex') }])) };
    privateWrite(metadata, JSON.stringify(state, null, 2));
  }
  const state = stateRead();
  const existing = assertOwned('container', state.container, state);
  if (!existing) {
    const buildLog = fs.openSync(path.join(lab, 'fixture-build.log'), 'w', 0o600);
    try { execFileSync('docker', ['build', '--tag', image, 'lab/android/pbx'], { cwd: root, timeout: 240000, stdio: ['ignore', buildLog, buildLog] }); } finally { fs.closeSync(buildLog); }
    state.imageId = docker(['image', 'inspect', image, '--format', '{{.Id}}']);
    privateWrite(metadata, JSON.stringify(state, null, 2));
    fs.mkdirSync(state.configDir, { recursive: true, mode: 0o700 });
    for (const [name, content] of Object.entries(configs(state.accounts))) privateWrite(path.join(state.configDir, name), content);
    if (!assertOwned('network', state.network, state)) docker(['network', 'create', '--driver', 'bridge', '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', '--label', `${label}=${owner}`, '--label', `com.phone11.android-lab.run=${state.runId}`, state.network]);
    docker(['run', '--detach', '--name', state.container, '--label', `${label}=${owner}`, '--label', `com.phone11.android-lab.run=${state.runId}`, '--network', state.network, '--read-only', '--cap-drop=ALL', '--cap-add=NET_ADMIN', '--cap-add=SETPCAP', '--security-opt', 'no-new-privileges', '--sysctl', 'net.ipv6.conf.all.disable_ipv6=1', '--dns', '127.0.0.1', '--pids-limit', '128', '--memory', '256m', '--cpus', '1', '--log-driver', 'none', '--publish', '127.0.0.1:15060:15060/udp', '--publish', '127.0.0.1:15060:15060/tcp', '--publish', '127.0.0.1:16000-16019:16000-16019/udp', '--mount', `type=bind,source=${state.configDir},target=/etc/asterisk,readonly`, '--tmpfs', '/var/run/asterisk:rw,noexec,nosuid,size=8m', '--tmpfs', '/var/log/asterisk:rw,noexec,nosuid,size=8m', '--tmpfs', '/var/lib/asterisk:rw,noexec,nosuid,size=16m', '--tmpfs', '/var/spool/asterisk:rw,noexec,nosuid,size=16m', '--tmpfs', '/tmp:rw,noexec,nosuid,size=8m', state.imageId]);
  } else if (!existing.State.Running) docker(['start', state.container]);
  return check(state);
}
function down() {
  if (!fs.existsSync(metadata)) return { status: 'DOWN', removed: 0 };
  const state = stateRead();
  // Inspect both resources before deleting either one.
  const container = assertOwned('container', state.container, state);
  const network = assertOwned('network', state.network, state);
  if (container) docker(['rm', '--force', state.container]);
  if (network) docker(['network', 'rm', state.network]);
  fs.rmSync(state.configDir, { recursive: true, force: true });
  fs.rmSync(metadata);
  return { status: 'DOWN', runId: state.runId, removed: Number(!!container) + Number(!!network) };
}
async function incoming() {
  const state = stateRead();
  if (!assertOwned('container', state.container, state)?.State.Running) throw new Error('Run fixture up first');
  const contacts = docker(['exec', state.container, 'asterisk', '-rx', 'pjsip show contacts']);
  if (!/7101\//.test(contacts)) throw new Error('7101 is not registered');
  const call = 'Channel: PJSIP/7101\nCallerID: Lab synthetic 7102 <7102>\nMaxRetries: 0\nRetryTime: 1\nWaitTime: 20\nContext: lab\nExtension: 7190\nPriority: 1\nArchive: no\n';
  execFileSync('docker', ['exec', '-i', state.container, 'sh', '-c', 'mkdir -p /var/spool/asterisk/outgoing; cat > /var/spool/asterisk/phone11-incoming.tmp; mv /var/spool/asterisk/phone11-incoming.tmp /var/spool/asterisk/outgoing/phone11-incoming.call'], { input: call, encoding: 'utf8', timeout: 5000, stdio: ['pipe','pipe','pipe'] });
  return { status: 'QUEUED', runId: state.runId, destination: '7101', caller: '7102', ringTimeoutSeconds: 20, answeredTimeoutSeconds: 20, scope: 'Synthetic incoming only; does not prove Android delivery or push' };
}
function hangup() {
  const state = stateRead();
  if (!assertOwned('container', state.container, state)?.State.Running) throw new Error('Run fixture up first');
  const rows = docker(['exec', state.container, 'asterisk', '-rx', 'core show channels concise']).split('\n');
  const channels = rows.map(row => row.split('!')[0]).filter(channel => /^PJSIP\/7101-[a-f0-9]+$/.test(channel));
  for (const channel of channels) docker(['exec', state.container, 'asterisk', '-rx', `channel request hangup ${channel}`]);
  return { status: 'REQUESTED', runId: state.runId, channels: channels.length, scope: 'Only synthetic 7101 channels in this owned container; CANCEL if ringing, BYE if answered' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const command = { up, down, incoming, 'incoming-cancel': hangup, 'remote-hangup': hangup }[process.argv[2]];
    if (!command) throw new Error('Expected up, down, or incoming');
    console.log(JSON.stringify(await command(), null, 2));
  } catch (error) {
    console.error(`Fixture failed: ${['Fixture ownership mismatch','Refusing unrelated Docker resource','PBX readiness failed','7101 is not registered','Run fixture up first','Expected up, down, or incoming'].includes(error.message) ? error.message : 'inspect private .lab/fixture-build.log; no credentials printed'}`);
    process.exitCode = 1;
  }
}
