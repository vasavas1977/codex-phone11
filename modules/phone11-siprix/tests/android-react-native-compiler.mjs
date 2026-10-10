import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifySdk } from "../android/verify-sdk.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("actual React Native 0.81.5 + pinned Siprix + Android API compile the three valid foreground/consultation gate configurations", () => {
  const aar = process.env.PHONE11_SIPRIX_ANDROID_AAR;
  const androidJar = process.env.PHONE11_ANDROID_API_JAR;
  const reactAar = process.env.PHONE11_REACT_ANDROID_AAR;
  const kotlinJar = process.env.PHONE11_KOTLIN_STDLIB_JAR;
  const fbjniAar = process.env.PHONE11_FBJNI_AAR;
  const inferJar = process.env.PHONE11_INFER_ANNOTATIONS_JAR;
  const kotlinAnnotations = process.env.PHONE11_KOTLIN_ANNOTATIONS_JAR;
  const jsr305Jar = process.env.PHONE11_JSR305_JAR;
  assert.ok(aar && androidJar && reactAar && kotlinJar && fbjniAar && inferJar && kotlinAnnotations && jsr305Jar, "Explicit cached SDK/Android/React Native dependency paths required; this compiler never skips or downloads");
  assert.equal(JSON.parse(readFileSync(path.join(root, "../../package.json"), "utf8")).dependencies["react-native"], "0.81.5");
  assert.match(path.basename(reactAar), /^react-android-0\.81\.5-(?:release|debug)\.aar$/);
  verifySdk(aar);
  const directory = mkdtempSync(path.join(tmpdir(), "phone11-android-real-rn-"));
  try {
    const sdkJar = path.join(directory, "siprix.jar");
    const reactJar = path.join(directory, "react-android.jar");
    const fbjniJar = path.join(directory, "fbjni.jar");
    for (const [archive, output] of [[aar, sdkJar], [reactAar, reactJar], [fbjniAar, fbjniJar]]) {
      writeFileSync(output, execFileSync("unzip", ["-p", archive, "classes.jar"], { maxBuffer: 32 * 1024 * 1024 }));
    }
    const source = path.join(root, "android/src/main/java/ai/phone11/siprix");
    const files = readdirSync(source).filter(name => name.endsWith(".java")).map(name => path.join(source, name));
    const buildLicense = path.join(realpathSync(directory), "phone11-native-license", "Phone11SiprixBuildLicense.java");
    execFileSync("python3", [path.join(root, "../../scripts/generate-phone11-native-license.py"), "--language", "java", "--output", buildLicense], {env: {PATH: process.env.PATH}, encoding: "utf8"});
    for (const [enabled,consultation] of [[false,false],[true,false],[true,true]]) {
      const buildConfig = path.join(directory, "BuildConfig.java");
      writeFileSync(buildConfig, `package ai.phone11.siprix; public final class BuildConfig {public static final boolean FOREGROUND_SOURCE_ENABLED=${enabled};public static final boolean CONSULTATION_SOURCE_ENABLED=${consultation};}`);
      execFileSync("javac", ["-Xlint:all", "-Werror", "-cp", [sdkJar, reactJar, androidJar, kotlinJar, fbjniJar, inferJar, kotlinAnnotations, jsr305Jar].join(path.delimiter),
        "-d", path.join(directory, `gate-${enabled}-${consultation}`), ...files, buildConfig, buildLicense], { encoding: "utf8", cwd: directory });
    }
    console.log("PASS actual React Native 0.81.5 declarations and exact SDK/Android APIs, gates OFF/OFF, ON/OFF, ON/ON; no declaration stubs, Gradle/APK/runtime/device claim.");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
