import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const leaf = "android/src/main/java/com/oney/WebRTCModule/Phone11ScreenTransaction.java";
function patchedCore() {
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
    const expected = patchedCore();
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
