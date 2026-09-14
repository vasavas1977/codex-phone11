import test from 'node:test';
import assert from 'node:assert/strict';
import { configs, validateRuntime, validateState } from '../fixture.mjs';

test('runtime isolation rejects public or ineffective published bindings', () => {
  const bindings = Object.fromEntries(['15060/tcp','15060/udp',...Array.from({length:20},(_,i)=>`${16000+i}/udp`)].map(port=>[port,[{HostIp:'127.0.0.1',HostPort:port.split('/')[0]}]]));
  const container={HostConfig:{PortBindings:bindings,ReadonlyRootfs:true,Privileged:false},NetworkSettings:{Ports:structuredClone(bindings)}};
  assert.doesNotThrow(()=>validateRuntime(container,{Driver:'bridge'}));
  assert.throws(()=>validateRuntime({...container,NetworkSettings:{Ports:{}}},{Driver:'bridge'}));
  container.HostConfig.PortBindings['15060/udp'][0].HostIp='0.0.0.0';
  assert.throws(()=>validateRuntime(container,{Driver:'bridge'}));
});
test('untrusted state cannot select unrelated resources or config paths for deletion', () => {
  assert.throws(()=>validateState({owner:'fake',runId:'0123456789abcdef',container:'production',network:'production',configDir:'/'}));
});
test('only synthetic dialplan destinations exist and every call is bounded', () => {
  const result = configs({'7101':{password:'a'.repeat(48)},'7102':{password:'b'.repeat(48)}});
  assert.deepEqual([...result['extensions.conf'].matchAll(/exten => ([^,]+),/g)].map(m=>m[1]),['7101','7102','7190','7191']);
  assert.equal((result['extensions.conf'].match(/TIMEOUT\(absolute\)=20/g)||[]).length,4);
  assert.match(result['extensions.conf'], /PlayTones\(440\)/);
  assert.match(result['extensions.conf'], /Echo\(\)/);
  assert.doesNotMatch(result['pjsip.conf'],/server_uri|outbound_proxy|type=registration/);
  assert.match(result['rtp.conf'], /rtpstart=16000\nrtpend=16019/);
});
test('config generator rejects injected SIP passwords', () => {
  assert.throws(()=>configs({'7101':{password:'injected\n[trunk]'},'7102':{password:'b'.repeat(48)}}));
});
