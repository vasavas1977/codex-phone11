import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve("expo-audio/package.json"));
test("real native state gates receiver volume, rejects speaker, isolates players, and forbids automatic resume", () => {
  const out = mkdtempSync(path.join(tmpdir(), "phone11-playback-state-"));
  try {
    execFileSync(
      "javac",
      [
        "-Xlint:all",
        "-Werror",
        "-d",
        out,
        path.join(
          root,
          "android/src/main/java/expo/modules/audio/PlaybackRouteState.java",
        ),
        fileURLToPath(
          new URL(
            "./phone11-android-playback-route-state.java",
            import.meta.url,
          ),
        ),
      ],
      { encoding: "utf8" },
    );
    const result = execFileSync(
      "java",
      ["-cp", out, "expo.modules.audio.AndroidPlaybackRouteStateTest"],
      { encoding: "utf8" },
    );
    assert.match(result, /PASS 51 Android per-player route state assertions/);
    console.log(result.trim());
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("Expo autolinking compiles the patched audio source instead of downloading a prebuilt module", () => {
  const repo = fileURLToPath(new URL("../", import.meta.url));
  const result = JSON.parse(
    execFileSync(
      "node",
      [
        createRequire(require.resolve("expo/package.json")).resolve(
          "expo-modules-autolinking/bin/expo-modules-autolinking.js",
        ),
        "resolve",
        "--platform",
        "android",
        "--json",
      ],
      { cwd: repo, encoding: "utf8" },
    ),
  );
  const audio = result.modules.find(
    (module) => module.packageName === "expo-audio",
  );
  assert.ok(audio, "expo-audio must be autolinked");
  assert.ok(
    result.configuration.buildFromSource.some((pattern) =>
      new RegExp(pattern).test(audio.packageName),
    ),
    "the Gradle autolinking configuration must force the patched module source",
  );
});
