import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const leaf = "android/src/main/java/com/oney/WebRTCModule/Phone11ScreenTransaction.java";
function patchedJava(leaf) {
  const patch = readFileSync(path.join(root, "patches/@livekit__react-native-webrtc@144.2.0.patch"), "utf8");
  const section = patch.split(`diff --git a/${leaf} b/${leaf}\n`)[1]?.split("diff --git ")[0];
  assert.ok(section, "Required native transaction patch is missing");
  return section.split("\n").filter(line => line.startsWith("+") && !line.startsWith("+++")).map(line => line.slice(1)).join("\n") + "\n";
}
function run(binary, args) {
  const result = spawnSync(binary, args, { encoding: "utf8", timeout: 30000 });
  assert.equal(result.error, undefined, `Required native compiler/runtime unavailable: ${result.error}`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}
test("actual patched native custody core executes nine cancellation/ACK/failure/retry scenarios", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "phone11-screen-core-test-"));
  try {
    const expected = patchedJava(leaf);
    let source = path.join(scratch, "Phone11ScreenTransaction.java");
    if (process.env.PHONE11_ANDROID_SCREEN_REQUIRE_INSTALLED_PATCH === "1") {
      source = path.join(root, "node_modules/@livekit/react-native-webrtc", leaf);
      assert.ok(existsSync(source), "Frozen install must apply the pinned Android bridge patch");
      assert.equal(readFileSync(source, "utf8"), expected, "Installed native custody core differs from reviewed patch");
    } else writeFileSync(source, expected);
    const classes = path.join(scratch, "classes"); mkdirSync(classes);
    const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin") : "";
    run(javaBin ? path.join(javaBin, "javac") : "javac", ["-d", classes, source,
      path.join(root, "tests/native/android-screen-transaction/Phone11ScreenTransactionTest.java")]);
    const output = run(javaBin ? path.join(javaBin, "java") : "java", ["-cp", classes, "com.oney.WebRTCModule.Phone11ScreenTransactionTest"]);
    assert.equal(output.split("\n").filter(line => line.startsWith("PASS ")).length, 9);
    assert.match(output, /9 native custody scenarios passed; no Android runtime capture proof/);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

// Extract whole method bodies from the reviewed new Java class. Track lexical
// strings/comments so brace delimiters are source boundaries, not assertions.
function method(source, signature) {
  const start = source.indexOf(signature); assert.notEqual(start, -1, `Missing native method ${signature}`);
  const open = source.indexOf('{', start); let depth = 0, quote, line = false, comment = false;
  for (let index = open; index < source.length; index++) {
    const char = source[index], next = source[index + 1];
    if (line) { if (char === '\n') line = false; continue; }
    if (comment) { if (char === '*' && next === '/') { comment = false; index++; } continue; }
    if (quote) { if (char === '\\') index++; else if (char === quote) quote = undefined; continue; }
    if (char === '/' && next === '/') { line = true; index++; continue; }
    if (char === '/' && next === '*') { comment = true; index++; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '{') depth++;
    if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed native method ${signature}`);
}
for (const scenario of ['publication', 'disposal']) test(`actual native bridge ${scenario} bodies fence retirement and retain disposal custody`, () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'phone11-screen-bridge-test-'));
  try {
    const bridgeLeaf = leaf.replace('Phone11ScreenTransaction.java', 'Phone11ScreenCaptureBridge.java');
    const expected = patchedJava(bridgeLeaf);
    let source = expected;
    if (process.env.PHONE11_ANDROID_SCREEN_REQUIRE_INSTALLED_PATCH === '1') {
      source = readFileSync(path.join(root, 'node_modules/@livekit/react-native-webrtc', bridgeLeaf), 'utf8');
      assert.equal(source, expected, 'Installed bridge differs from reviewed patch');
    }
    let probe = readFileSync(path.join(root, 'tests/native/android-screen-transaction/Phone11ScreenBridgeProbe.java.template'), 'utf8');
    for (const [marker, signature] of [['BEGIN', 'void begin('], ['CANCEL', 'void cancel('], ['INVALIDATE', 'void invalidate()'], ['DESTROY', 'public void onHostDestroy()'], ['PAUSE', 'public void onHostPause()']]) probe = probe.replace(`@@${marker}@@`, method(source, signature));
    writeFileSync(path.join(scratch, 'Phone11ScreenCaptureBridge.java'), probe);
    let resources = readFileSync(path.join(root, 'tests/native/android-screen-transaction/Phone11ScreenResourceProbe.java.template'), 'utf8');
    const capture = method(source, 'public WritableMap capture()');
    const attachment = capture.slice(capture.indexOf('MediaStream stream ='), capture.indexOf('return data;') + 'return data;'.length);
    assert.ok(attachment.startsWith('MediaStream stream =') && attachment.endsWith('return data;'), 'Required actual stream attachment body missing');
    resources = resources.replace('@@ATTACH@@', attachment).replace('@@DISPOSE@@', method(source, 'public void disposeCapture()'));
    writeFileSync(path.join(scratch, 'Phone11ScreenResourceProbe.java'), resources);
    writeFileSync(path.join(scratch, 'Phone11ScreenTransaction.java'), patchedJava(leaf));
    writeFileSync(path.join(scratch, 'LifecycleState.java'), 'package com.facebook.react.common; public enum LifecycleState { RESUMED }');
    const classes = path.join(scratch, 'classes'); mkdirSync(classes);
    const bin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin') : '';
    run(bin ? path.join(bin, 'javac') : 'javac', ['-d', classes, ...['Phone11ScreenTransaction', 'Phone11ScreenCaptureBridge', 'Phone11ScreenResourceProbe', 'LifecycleState'].map(name => path.join(scratch, name + '.java'))]);
    if (scenario === 'publication') {
      const publication = run(bin ? path.join(bin, 'java') : 'java', ['-cp', classes, 'com.oney.WebRTCModule.Phone11ScreenCaptureBridge']);
      assert.equal(publication.split('\n').filter(line => line.startsWith('PASS ')).length, 6);
    } else {
      const disposal = run(bin ? path.join(bin, 'java') : 'java', ['-cp', classes, 'com.oney.WebRTCModule.Phone11ScreenResourceProbe']);
      assert.equal(disposal.split('\n').filter(line => line.startsWith('PASS ')).length, 2);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('actual native service body requires foreground and exact destruction ACK for queued cancellation', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'phone11-screen-service-test-'));
  try {
    const serviceLeaf = leaf.replace('Phone11ScreenTransaction.java', 'Phone11ScreenProjectionService.java');
    const expected = patchedJava(serviceLeaf); let source = expected;
    if (process.env.PHONE11_ANDROID_SCREEN_REQUIRE_INSTALLED_PATCH === '1') {
      source = readFileSync(path.join(root, 'node_modules/@livekit/react-native-webrtc', serviceLeaf), 'utf8');
      assert.equal(source, expected, 'Installed service differs from reviewed patch');
    }
    let body = source.slice(source.indexOf('/** Separate'));
    assert.ok(body.includes('public final class Phone11ScreenProjectionService extends Service'), 'Required actual service body missing');
    const probes = `
    static void check(boolean value){if(!value)throw new AssertionError("service ACK custody violated");}
    static void reset(){active=null;Handler.q.clear();}
    public static void main(String[]args){
      reset();Context c=new Context();AtomicBoolean retired=new AtomicBoolean();Record r=prepare("queued",retired::get);launch(c,r);Handler.drain();check(r.requested&&!r.started.isDone());retired.set(true);
      Phone11ScreenProjectionService service=new Phone11ScreenProjectionService();service.onCreate();service.onStartCommand(c.submitted,0,1);check(r.started.isCompletedExceptionally()&&service.foreground==0&&service.selfStops==1);
      CompletableFuture<Void> stop=stop(c,r);Handler.drain();check(c.stops==1&&!stop.isDone());try{prepare("replacement",()->false);throw new AssertionError("replacement overwrote pending service");}catch(IllegalStateException expected){}
      service.onDestroy();check(stop.isDone());Record fresh=prepare("fresh",()->false);service.onDestroy();check(active==fresh&&!fresh.started.isDone());System.out.println("PASS queued cancellation and exact destroy receipt");
      reset();c=new Context();r=prepare("valid",()->false);launch(c,r);Handler.drain();service=new Phone11ScreenProjectionService();service.onCreate();check(!r.started.isDone());service.onStartCommand(c.submitted,0,1);check(r.started.isDone()&&!r.started.isCompletedExceptionally()&&service.foreground==1);stop=stop(c,r);Handler.drain();check(!stop.isDone());service.onDestroy();check(stop.isDone());System.out.println("PASS foreground success before ACK");
      reset();c=new Context();r=prepare("failure",()->false);launch(c,r);Handler.drain();service=new Phone11ScreenProjectionService();service.foregroundThrows=true;service.onCreate();service.onStartCommand(c.submitted,0,1);check(r.started.isCompletedExceptionally());stop=stop(c,r);Handler.drain();check(!stop.isDone());service.onDestroy();check(stop.isDone());System.out.println("PASS foreground failure retains destroy custody");
      reset();c=new Context();c.launchThrows=true;r=prepare("uncertain",()->false);launch(c,r);Handler.drain();check(r.requested&&r.started.isCompletedExceptionally());stop=stop(c,r);Handler.drain();check(!stop.isDone()&&active==r);System.out.println("PASS uncertain submitted start never claims absent-service ACK");
      reset();c=new Context();r=prepare("pre-submit",()->true);launch(c,r);Handler.drain();check(!r.requested&&c.requests==0);stop=stop(c,r);Handler.drain();check(stop.isDone()&&active==null);System.out.println("PASS proven pre-submit retirement drains without launch");
    }
`;
    body = body.slice(0, body.lastIndexOf('}')) + probes + '}';
    const template = readFileSync(path.join(root, 'tests/native/android-screen-transaction/Phone11ScreenServiceProbe.java.template'), 'utf8');
    const file = path.join(scratch, 'Phone11ScreenProjectionService.java'); writeFileSync(file, template.replace('@@SERVICE@@', body));
    const classes = path.join(scratch, 'classes'); mkdirSync(classes);
    const bin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin') : '';
    run(bin ? path.join(bin, 'javac') : 'javac', ['-d', classes, file]);
    const output = run(bin ? path.join(bin, 'java') : 'java', ['-cp', classes, 'com.oney.WebRTCModule.Phone11ScreenProjectionService']);
    assert.equal(output.split('\n').filter(line => line.startsWith('PASS ')).length, 5);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
