import { spawn } from 'node:child_process';
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RATE = 8000;

export function testWave(seconds = 12) {
  const samples = new Int16Array(RATE * seconds);
  let phase = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    const freq = 350 + 650 * ((t * 0.371 + Math.floor(t) * 0.173) % 1);
    phase += 2 * Math.PI * freq / RATE;
    samples[i] = Math.round(9000 * Math.sin(phase) * (0.65 + 0.3 * Math.sin(t * 7)));
  }
  return samples;
}

export function wav(samples) {
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(RATE, 24); data.writeUInt32LE(RATE * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36);
  data.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, i) => data.writeInt16LE(sample, 44 + i * 2));
  return data;
}

export function readWav(data) {
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Invalid WAV');
  let format, samples;
  for (let p = 12; p + 8 <= data.length;) {
    const tag = data.toString('ascii', p, p + 4), n = data.readUInt32LE(p + 4);
    if (p + 8 + n > data.length) throw new Error('Truncated WAV');
    if (tag === 'fmt ') {
      format = [data.readUInt16LE(p + 8), data.readUInt16LE(p + 10), data.readUInt32LE(p + 12), data.readUInt16LE(p + 22)];
    }
    if (tag === 'data') {
      samples = new Int16Array(n / 2);
      samples.forEach((_, i) => { samples[i] = data.readInt16LE(p + 8 + i * 2); });
    }
    p += 8 + n + n % 2;
  }
  if (JSON.stringify(format) !== JSON.stringify([1, 1, RATE, 16]) || !samples) throw new Error('Expected mono 8 kHz PCM16');
  return samples;
}

export function compareWave(sent, received) {
  const energy = received.reduce((sum, x) => sum + x * x, 0);
  let best = { correlation: 0, delaySamples: 0 };
  // Align a five-second window; the recorder can start before the SIP answer.
  function score(delay) {
    const start = Math.max(0, delay), end = Math.min(received.length, sent.length + delay, start + 5 * RATE);
    if (end - start < 3 * RATE) return 0;
    let xy = 0, xx = 0, yy = 0;
    for (let i = start; i < end; i += 4) {
      const x = sent[i - delay], y = received[i];
      xy += x * y; xx += x * x; yy += y * y;
    }
    return xx && yy ? xy / Math.sqrt(xx * yy) : 0;
  }
  for (let delay = -RATE; delay <= 4 * RATE; delay += 4) {
    const correlation = score(delay);
    if (correlation > best.correlation) best = { correlation, delaySamples: delay };
  }
  const coarse = best.delaySamples;
  for (let delay = coarse - 4; delay <= coarse + 4; delay++) {
    const correlation = score(delay);
    if (correlation > best.correlation) best = { correlation, delaySamples: delay };
  }
  return { ...best, rms: Math.sqrt(energy / Math.max(1, received.length)), seconds: received.length / RATE };
}

export function compareWindows(sent, received) {
  const windows = [];
  // Jitter-buffer adjustments shift timing. Report them, rather than treating
  // a partial match or nonzero packet count as uninterrupted audio proof.
  for (let second = 1; second < Math.min(sent.length, received.length) / RATE - 1; second++) {
    let best = { correlation: 0, delaySamples: 0 };
    for (let delay = 0; delay < RATE / 2; delay++) {
      let xy = 0, xx = 0, yy = 0;
      for (let i = second * RATE; i < (second + 1) * RATE; i += 4) {
        const x = sent[i - delay], y = received[i];
        xy += x * y; xx += x * x; yy += y * y;
      }
      const correlation = xx && yy ? xy / Math.sqrt(xx * yy) : 0;
      if (correlation > best.correlation) best = { correlation, delaySamples: delay };
    }
    windows.push({ second, ...best });
  }
  return { windows, matchingSeconds: windows.filter(w => w.correlation > 0.95).length };
}

export function signalingEvidence(log, callId) {
  let byeAcknowledged = false, answerCount = 0, malformedAnswers = 0, privateMediaAnswers = 0;
  for (const m of log.matchAll(/RX [^\n]+:\n([\s\S]*?)--end msg--/g)) {
    const [head, body = ''] = m[1].split(/\r?\n\r?\n/);
    if (callId && head.match(/^Call-ID:\s*(\S+)/im)?.[1] !== callId) continue;
    if (!/^SIP\/2.0 200 /.test(head)) continue;
    if (/^CSeq:\s*\d+ BYE\s*$/im.test(head)) byeAcknowledged = true;
    if (!/^CSeq:\s*\d+ INVITE\s*$/im.test(head)) continue;
    answerCount++;
    const lines = body.trim().split(/\r?\n/).filter(Boolean);
    if (!lines.length || lines.some(line => !/^[a-z]=/.test(line))) malformedAnswers++;
    if (lines.some(line => /^c=IN IP4 (10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(line))) privateMediaAnswers++;
  }
  return { byeAcknowledged, answerCount, malformedAnswers, privateMediaAnswers };
}

async function main() {
  const bin = process.env.PJSUA_BIN;
  const dir = resolve(process.argv[2] || '');
  if (!bin || !process.argv[2]) throw new Error('PJSUA_BIN and private evidence directory required');
  const password = readFileSync(0, 'utf8').trimEnd();
  if (!password || /[\s"\\]/.test(password)) throw new Error('Credential is empty or unsuitable for the config parser');
  mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
  const sent = testWave();
  writeFileSync(resolve(dir, 'sent.wav'), wav(sent), { mode: 0o600 });
  const logPath = resolve(dir, 'pjsua.private.log');
  const fd = openSync(logPath, 'wx', 0o600);
  // No registrar: authenticate INVITE only and preserve the handset contact.
  // Hard-coded private echo target and disabled redirects prevent PSTN calls.
  const args = ['--config-file=/dev/fd/3', '--id=sip:1001@sip.phone11.ai',
    '--proxy=sip:sip.phone11.ai:5060;transport=udp;lr', '--null-audio', '--no-tcp',
    '--local-port=5092', '--rtp-port=42000', '--clock-rate=8000', '--snd-clock-rate=8000',
    '--dis-codec=*', '--add-codec=PCMU/8000', '--no-vad', '--no-tones',
    '--auto-play', `--play-file=${resolve(dir, 'sent.wav')}`, '--auto-rec',
    `--rec-file=${resolve(dir, 'returned.wav')}`, '--duration=12', '--max-calls=1',
    '--accept-redirect=0', '--log-level=5', '--app-log-level=5', '--no-color',
    'sip:*9196@sip.phone11.ai'];
  const child = spawn(bin, args, { stdio: ['pipe', fd, fd, 'pipe'] });
  child.stdin.on('error', () => {}); child.stdio[3].on('error', () => {});
  child.stdio[3].end(`--realm=*\n--username=1001\n--password=${password}\n`);
  const dump = setTimeout(() => child.stdin.write('dq\n'), 10000);
  const quit = setTimeout(() => child.stdin.end('q\n'), 17000);
  const kill = setTimeout(() => child.kill('SIGTERM'), 23000);
  const result = await new Promise((resolveResult, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveResult({ code, signal }));
  }).finally(() => { clearTimeout(dump); clearTimeout(quit); clearTimeout(kill); closeSync(fd); });
  const log = readFileSync(logPath, 'utf8');
  const confirmed = /state changed to CONFIRMED/.test(log);
  const callIds = [...new Set([...log.matchAll(/^Call-ID:\s*(\S+)/gm)].map(x => x[1]))];
  const testCallId = log.match(/TX [^\n]*Request msg INVITE[^\n]*:\n[\s\S]*?^Call-ID:\s*(\S+)/m)?.[1];
  const signaling = signalingEvidence(log, testCallId);
  let measurement;
  try {
    const received = readWav(readFileSync(resolve(dir, 'returned.wav')));
    measurement = { ...compareWave(sent, received), ...compareWindows(sent, received) };
  }
  catch (error) { measurement = { error: error.message }; }
  const signalRoundTripVerified = measurement.matchingSeconds >= 5;
  const pass = result.code === 0 && Boolean(testCallId) && confirmed && signaling.byeAcknowledged && !signaling.malformedAnswers &&
    !signaling.privateMediaAnswers && signalRoundTripVerified && measurement.correlation > 0.8 && measurement.seconds >= 5;
  const report = { createdAt: new Date().toISOString(), scope: 'Mac PJSUA -> public SIP proxy -> private FreeSWITCH echo -> Mac; not iPhone or PSTN proof',
    destination: 'sip:*9196@sip.phone11.ai', ...result, confirmed, testCallId, callIds, signaling, measurement, signalRoundTripVerified, pass };
  writeFileSync(resolve(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = pass ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
