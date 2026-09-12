import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const base=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,base),'utf8');
const routes=read('infra/configs/kamailio/phone11-wake-candidate/routes.inc');
const modules=read('infra/configs/kamailio/phone11-wake-candidate/modules.inc');
const body=name=>routes.split(`route[${name}] {`)[1]?.split(/\n(?:route|failure_route)\[/)[0]??'';
test('candidate is absent from both deployment configurations and fully gated',()=>{
  for(const path of ['infra/configs/kamailio/kamailio.cfg','deploy/kamailio/kamailio.cfg']) {
    assert.doesNotMatch(read(path),/WITH_PHONE11_WAKE_CANDIDATE|phone11-wake-candidate/);
  }
  for(const source of [routes,modules]) {
    assert.doesNotMatch(source,/^#!define WITH_PHONE11_WAKE_CANDIDATE/m);
    const activeLines=source.split('\n').filter(line=>line.trim()&&!line.trim().startsWith('#'));
    const gate=source.indexOf('#!ifdef WITH_PHONE11_WAKE_CANDIDATE'),end=source.lastIndexOf('#!endif');
    assert.ok(gate>=0&&end>gate);
    for(const line of activeLines) assert.ok(source.indexOf(line)>gate&&source.indexOf(line)<end);
  }
});
test('only an initial exact-pilot INVITE enters suspension; no alternate call is originated',()=>{
  const start=body('PHONE11_WAKE_START');
  assert.match(start,/!is_method\("INVITE"\).*has_totag\(\).*\$ru != PHONE11_WAKE_PILOT_URI/);
  assert.ok(start.indexOf('t_newtran()')<start.indexOf('http_async_query('));
  assert.doesNotMatch(routes,/t_uac|t_suspend\(|t_continue\(|exec\(|system\(/);
  const resume=body('PHONE11_WAKE_RESUME');
  assert.ok(resume.indexOf('t_is_canceled()')<resume.indexOf('lookup("location")'));
  assert.ok(resume.indexOf('lookup("location")')<resume.indexOf('route(PHONE11_INBOUND_OFFER)'));
  assert.ok(resume.indexOf('route(PHONE11_INBOUND_OFFER)')<resume.indexOf('route(PHONE11_WAKE_RELAY)'));
});
test('correlation discards spoofed headers and rejects invalid server UUID before forwarding',()=>{
  assert.ok(body('PHONE11_WAKE_START').indexOf('remove_hf("X-Phone11-Wake-ID")')<body('PHONE11_WAKE_START').indexOf('t_newtran()'));
  const resume=body('PHONE11_WAKE_RESUME');
  assert.match(resume,/jansson_get\("callUUID"/);
  assert.match(resume,/\[0-9a-fA-F\]\{8\}-\[0-9a-fA-F\]\{4\}-4\[0-9a-fA-F\]\{3\}-\[89aAbB\]\[0-9a-fA-F\]\{3\}-\[0-9a-fA-F\]\{12\}/);
  const validation=resume.indexOf('!($var(wake_status) =~ "^ready$")'),remove=resume.indexOf('remove_hf("X-Phone11-Wake-ID")'),append=resume.indexOf('append_hf("X-Phone11-Wake-ID:');
  assert.ok(validation>=0&&remove>validation&&append>remove);
  assert.match(resume.slice(validation,remove),/t_reply\("480"[\s\S]*exit;/);
});
test('JSON values are encoded and terminal callbacks cannot block or relay SIP',()=>{
  for(const source of [body('PHONE11_WAKE_START'),body('PHONE11_WAKE_TERMINAL')]) {
    assert.match(source,/jansson_set\("string", "sipCallId", "\$ci"/);
    assert.match(source,/\$http_req\(hdr\) = "X-Push-Secret: " \+ PHONE11_WAKE_SECRET/);
    assert.doesNotMatch(source,/secret=|xlog\(/);
  }
  assert.match(body('PHONE11_WAKE_TERMINAL'),/\$http_req\(suspend\) = 0/);
  assert.match(body('PHONE11_WAKE_TERMINAL'),/\$http_req\(timeout\) = 2000/);
  assert.doesNotMatch(body('PHONE11_WAKE_TERMINAL_RESULT'),/t_reply\(|t_relay\(|route\(RELAY\)/);
  assert.match(modules,/"curl_verbose", 0/);assert.match(modules,/"curl_follow_redirect", 0/);
});
