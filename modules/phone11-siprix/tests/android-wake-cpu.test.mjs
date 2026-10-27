import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("Android incoming setup CPU handoff is bounded and fenced in real Java", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const out = mkdtempSync(path.join(tmpdir(), "phone11-wake-cpu-"));
  try {
    execFileSync("javac", ["-Xlint:all", "-Werror", "-d", out,
      path.join(root, "android/src/main/java/ai/phone11/siprix/Phone11WakeCpuState.java"),
      path.join(root, "android/src/main/java/ai/phone11/siprix/Phone11WakeCpuTimer.java"),
      path.join(root, "android/src/main/java/ai/phone11/siprix/Phone11AndroidWakeState.java"),
      path.join(root, "tests/android-wake-cpu.java")], { encoding: "utf8" });
    const result = execFileSync("java", ["-cp", out, "ai.phone11.siprix.AndroidWakeCpuTest"], { encoding: "utf8" });
    assert.match(result, /PASS \d+ wake CPU handoff\/lifecycle\/failure assertions/);
    console.log(result.trim());
  } finally { rmSync(out, { recursive: true, force: true }); }
});
