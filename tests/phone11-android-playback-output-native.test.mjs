import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const nativeDir = path.join(root, "modules/phone11-siprix/android/src/main/java/ai/phone11/siprix");

test("pure JVM output contract uses native IDs and generic Bluetooth labels", () => {
  const output = mkdtempSync(path.join(tmpdir(), "phone11-audio-output-"));
  const compile = spawnSync("javac", ["-d", output,
    path.join(nativeDir, "Phone11PlaybackAudioOutput.java"),
    path.join(root, "lab/android/java-tests/PlaybackAudioOutputContract.java")], { encoding: "utf8" });
  assert.equal(compile.status, 0, compile.stderr || compile.stdout);
  const run = spawnSync("java", ["-cp", output, "ai.phone11.siprix.PlaybackAudioOutputContract"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test("Android router uses exact communication devices without exporting private names", () => {
  const router = readFileSync(path.join(nativeDir, "Phone11PlaybackAudioRouter.java"), "utf8");
  const bridge = readFileSync(path.join(nativeDir, "Phone11SiprixModule.java"), "utf8");
  assert.match(router, /getAvailableCommunicationDevices\(\)/);
  assert.match(router, /setCommunicationDevice\(selected\.info\)/);
  assert.match(router, /getCommunicationDevice\(\)/);
  assert.match(router, /clearCommunicationDevice\(\)/);
  assert.doesNotMatch(router, /getProductName|getAddress/);
  assert.match(router, /Android 11 and earlier cannot bind one concrete Bluetooth output/);
  assert.match(bridge, /requirePlaybackRouteOwnership\(\);return rt\.playbackAudio\.select/);
  assert.match(bridge, /p\.reject\("CALL_AUDIO_ACTIVE"/);
  assert.match(bridge, /releasePlaybackSelection\(\);\n\s*Map<String,Object> c=newCall/);
});
