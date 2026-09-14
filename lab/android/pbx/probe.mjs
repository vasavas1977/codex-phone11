// Host-side synthetic 7102 probe. This is PBX proof, never Siprix/emulator proof.
import fs from 'node:fs';
import dgram from 'node:dgram';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const lab = fileURLToPath(new URL('../../../.lab/', import.meta.url));
const state = JSON.parse(fs.readFileSync(path.join(lab, 'fixture.json')));
const md5 = value => createHash('md5').update(value).digest('hex');
const id = randomBytes(10).toString('hex');
const sip = dgram.createSocket('udp4'), rtp = dgram.createSocket('udp4');
const bind = socket => new Promise(resolve => socket.bind(0, '127.0.0.1', resolve));
await Promise.all([bind(sip), bind(rtp)]);
const port = sip.address().port;
const contact = `<sip:7102@127.0.0.1:${port}>`;
let cseq = 0, auth, to = '<sip:7190@127.0.0.1:15060>', inviteSeq, timer, active = false;
const packets = [];
rtp.on('message', packet => { if (packet.length >= 172 && (packet[1] & 127) === 0) packets.push(packet.subarray(12)); });
const header = (message, name) => message.match(new RegExp(`^${name}:\\s*(.+)$`, 'im'))?.[1]?.trim();
function authorization(method, uri) {
  if (!auth) return '';
  const response = md5(`${md5(`7102:${auth.realm}:${state.accounts['7102'].password}`)}:${auth.nonce}:${md5(`${method}:${uri}`)}`);
  return `Authorization: Digest username="7102", realm="${auth.realm}", nonce="${auth.nonce}", uri="${uri}", response="${response}", algorithm=MD5\r\n`;
}
function request(method, uri, body = '', sequence, extra = '') {
  const seq = sequence ?? ++cseq;
  const message = `${method} ${uri} SIP/2.0\r\nVia: SIP/2.0/UDP 127.0.0.1:${port};branch=z9hG4bK${id}${seq}${method};rport\r\nFrom: <sip:7102@127.0.0.1>;tag=${id}\r\nTo: ${method === 'REGISTER' ? '<sip:7102@127.0.0.1>' : to}\r\nCall-ID: ${id}\r\nCSeq: ${seq} ${method}\r\nContact: ${contact}\r\nMax-Forwards: 70\r\n${authorization(method, uri)}${extra}${body ? 'Content-Type: application/sdp\r\n' : ''}Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
  if (method === 'ACK') { sip.send(message, 15060, '127.0.0.1'); return; }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { sip.off('message', onMessage); reject(new Error(`${method} timed out`)); }, 5000);
    function onMessage(buffer) {
      const message = buffer.toString();
      if (header(message, 'CSeq') !== `${seq} ${method}` || !/^SIP\/2.0 [2-6]/.test(message)) return;
      clearTimeout(timeout); sip.off('message', onMessage); resolve({ code: Number(message.slice(8, 11)), message, seq });
    }
    sip.on('message', onMessage); sip.send(message, 15060, '127.0.0.1');
  });
}
async function authenticated(method, uri, body = '', extra = '') {
  let result = await request(method, uri, body, undefined, extra);
  if (result.code === 401) {
    if (method === 'INVITE') request('ACK', uri, '', result.seq);
    const challenge = header(result.message, 'WWW-Authenticate');
    auth = Object.fromEntries([...challenge.matchAll(/(realm|nonce)="([^"]+)"/g)].map(match => [match[1], match[2]]));
    result = await request(method, uri, body, undefined, extra);
  }
  return result;
}
function decodeMuLaw(byte) {
  const u = (~byte) & 255;
  let sample = (((u & 15) << 3) + 132) << ((u & 112) >> 4);
  sample -= 132;
  return (u & 128) ? -sample : sample;
}
let outcome;
try {
  const registered = await authenticated('REGISTER', 'sip:127.0.0.1:15060', '', 'Expires: 60\r\n');
  if (registered.code !== 200) throw new Error(`REGISTER ${registered.code}`);
  const sdp = `v=0\r\no=phone11 1 1 IN IP4 127.0.0.1\r\ns=Phone11 synthetic host probe\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\nm=audio ${rtp.address().port} RTP/AVP 0\r\na=rtpmap:0 PCMU/8000\r\na=sendrecv\r\n`;
  const invited = await authenticated('INVITE', 'sip:7190@127.0.0.1:15060', sdp);
  if (invited.code !== 200) throw new Error(`INVITE ${invited.code}`);
  active = true; inviteSeq = invited.seq; to = header(invited.message, 'To');
  request('ACK', 'sip:7190@127.0.0.1:15060', '', inviteSeq);
  const remotePort = Number(invited.message.match(/m=audio (\d+)/)?.[1]);
  if (remotePort < 16000 || remotePort > 16019) throw new Error('Unexpected RTP port');
  let sequence = 0;
  timer = setInterval(() => {
    const packet = Buffer.alloc(172, 255); packet[0] = 128; packet[1] = 0; packet.writeUInt16BE(sequence & 65535, 2); packet.writeUInt32BE(sequence++ * 160, 4); packet.writeUInt32BE(0x71107110, 8);
    rtp.send(packet, remotePort, '127.0.0.1');
  }, 20);
  await new Promise(resolve => setTimeout(resolve, 1800));
  clearInterval(timer);
  const samples = [...Buffer.concat(packets)].map(decodeMuLaw);
  const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
  let crossing = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] <= 0 && samples[i] > 0) crossing++;
  const frequency = crossing * 8000 / samples.length;
  if (packets.length < 30 || !Number.isFinite(rms) || rms < 100 || Math.abs(frequency - 440) > 25) throw new Error('440 Hz decoded audio not verified');
  const ended = await authenticated('BYE', 'sip:7190@127.0.0.1:15060'); active = false;
  if (ended.code !== 200) throw new Error(`BYE ${ended.code}`);
  outcome = { at: new Date().toISOString(), runId: state.runId, status: 'PASS', scope: 'Host synthetic SIP/PBX only; not Android Siprix, handset, microphone, or audible speaker proof', registration: 200, toneInvite: 200, bye: 200, rtpPackets: packets.length, decodedSamples: samples.length, sampleRate: 8000, rms: Math.round(rms), estimatedHz: Number(frequency.toFixed(1)) };
} catch (error) {
  outcome = { at: new Date().toISOString(), runId: state.runId, status: 'FAIL', scope: 'Host synthetic SIP/PBX only', reason: error.message };
  process.exitCode = 1;
} finally {
  clearInterval(timer);
  if (active) try { await authenticated('BYE', 'sip:7190@127.0.0.1:15060'); } catch {}
  try { await authenticated('REGISTER', 'sip:127.0.0.1:15060', '', 'Expires: 0\r\n'); } catch {}
  sip.close(); rtp.close();
}
fs.writeFileSync(path.join(lab, 'fixture-probe.json'), JSON.stringify(outcome, null, 2), { mode: 0o600 });
console.log(JSON.stringify(outcome, null, 2));
