import test from 'node:test';
import assert from 'node:assert/strict';
import { testWave, wav, readWav, compareWave, compareWindows, signalingEvidence } from '../scripts/phone11-echo-probe.mjs';

test('test signal survives WAV round trip', () => {
  const input = testWave(4);
  assert.deepEqual(readWav(wav(input)), input);
});

test('recognizes delayed attenuated echo, not silence or unrelated audio', () => {
  const input = testWave(6), received = new Int16Array(input.length + 987);
  received.set(input.map(x => Math.round(x / 3)), 987);
  const match = compareWave(input, received);
  assert.equal(match.delaySamples, 987);
  assert.ok(match.correlation > 0.99);
  assert.equal(compareWave(input, new Int16Array(input.length)).correlation, 0);
  const unrelated = Int16Array.from(input, (_, i) => Math.round(5000 * Math.sin(i * 0.41)));
  assert.ok(compareWave(input, unrelated).correlation < 0.2);
  assert.equal(compareWindows(input, unrelated).matchingSeconds, 0);
  assert.ok(compareWindows(input, received).matchingSeconds >= 3);
});

test('connected does not imply hangup succeeded or valid public SDP', () => {
  const response = (method, body = '') => `RX message:\nSIP/2.0 200 OK\r\nCSeq: 2 ${method}\r\n\r\n${body}\n--end msg--`;
  const valid = response('INVITE', 'v=0\r\nc=IN IP4 43.210.122.111\r\n');
  assert.deepEqual(signalingEvidence(valid), { byeAcknowledged: false, answerCount: 1, malformedAnswers: 0, privateMediaAnswers: 0 });
  assert.equal(signalingEvidence(valid + response('BYE')).byeAcknowledged, true);
  assert.equal(signalingEvidence(response('INVITE', 'v=0\r\n43.210.122.111')).malformedAnswers, 1);
  assert.equal(signalingEvidence(response('INVITE', 'v=0\r\nc=IN IP4 10.0.1.69')).privateMediaAnswers, 1);
  const stale = response('BYE').replace('CSeq:', 'Call-ID: previous-call\r\nCSeq:');
  assert.equal(signalingEvidence(stale, 'current-call').byeAcknowledged, false);
});
