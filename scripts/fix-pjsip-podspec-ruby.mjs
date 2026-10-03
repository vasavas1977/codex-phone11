import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const podspecPath = path.join(
  process.cwd(),
  "node_modules",
  "react-native-pjsip",
  "react-native-pjsip.podspec"
);

let source;
try {
  source = await readFile(podspecPath, "utf8");
} catch (error) {
  if (error?.code === "ENOENT") {
    console.warn(`[phone11-pjsip-podspec-ruby] Skipping missing podspec: ${podspecPath}`);
    process.exit(0);
  }
  throw error;
}

let next = source
  .replace(
    /^\s+"FRAMEWORK_SEARCH_PATHS"\s*=>.*$/m,
    `    "FRAMEWORK_SEARCH_PATHS" => '$(inherited) "\${PODS_TARGET_SRCROOT}/ios"',`
  )
  .replace(
    /^\s+"HEADER_SEARCH_PATHS"\s*=>.*$/m,
    `    "HEADER_SEARCH_PATHS" => '$(inherited) "\${PODS_TARGET_SRCROOT}/ios/VialerPJSIP.framework/Headers"',`
  );

if (next === source) {
  console.log("[phone11-pjsip-podspec-ruby] Podspec Ruby quoting already valid.");
  process.exit(0);
}

await writeFile(podspecPath, next);
console.log(`[phone11-pjsip-podspec-ruby] Rewrote Ruby-safe search paths in ${podspecPath}`);
