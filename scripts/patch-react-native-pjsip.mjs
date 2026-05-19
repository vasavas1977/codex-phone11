import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const packageRoot = path.join(process.cwd(), "node_modules", "react-native-pjsip");
const podspecPath = path.join(packageRoot, "react-native-pjsip.podspec");
const iosRoot = path.join(packageRoot, "ios");
const iosModulePath = path.join(iosRoot, "RTCPjSip", "PjSipModule.m");
const androidRoot = path.join(packageRoot, "android");
const gradlePath = path.join(androidRoot, "build.gradle");
const manifestPath = path.join(androidRoot, "src", "main", "AndroidManifest.xml");
const sourceRoot = path.join(androidRoot, "src", "main", "java");
const fallbackNamespace = "com.carusto.ReactNativePjSip";
const iosBridgeHeaderImport = "#import <React/RCTBridgeModule.h>";

async function readIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function patchFile(filePath, patcher) {
  const source = await readIfExists(filePath);
  if (source === null) {
    console.warn(`[phone11-pjsip-patch] Skipping missing file: ${filePath}`);
    return false;
  }

  const next = patcher(source);
  if (next === source) {
    return false;
  }

  await writeFile(filePath, next);
  return true;
}

async function findEntries(rootPath, predicate) {
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const matches = [];
  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (predicate(entry, entryPath)) {
      matches.push(entryPath);
    }

    if (entry.isDirectory() && !entry.name.endsWith(".framework") && !entry.name.endsWith(".xcodeproj")) {
      matches.push(...(await findEntries(entryPath, predicate)));
    }
  }

  return matches;
}

async function patchSourceTree(rootPath) {
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      console.warn(`[phone11-pjsip-patch] Skipping missing source tree: ${rootPath}`);
      return false;
    }
    throw error;
  }

  let changed = false;
  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      changed = (await patchSourceTree(entryPath)) || changed;
      continue;
    }

    if (!/\.(java|kt)$/.test(entry.name)) {
      continue;
    }

    changed =
      (await patchFile(entryPath, (source) =>
        source.replace(/\bandroid\.support\.annotation\./g, "androidx.annotation.")
      )) || changed;
  }

  return changed;
}

function toPosixRelative(filePath) {
  return path.relative(packageRoot, filePath).split(path.sep).join("/");
}

function toRubyArray(values) {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

async function ensurePjSipPodspec() {
  const packageJsonPath = path.join(packageRoot, "package.json");
  const packageJson = await readIfExists(packageJsonPath);
  if (packageJson === null) {
    console.warn(`[phone11-pjsip-patch] Skipping podspec creation; missing package.json: ${packageJsonPath}`);
    return false;
  }

  const frameworkPaths = (
    await findEntries(iosRoot, (entry) => entry.isDirectory() && entry.name.endsWith(".framework"))
  )
    .map(toPosixRelative)
    .sort();

  const vendoredFrameworks =
    frameworkPaths.length > 0
      ? `  s.vendored_frameworks = ${toRubyArray(frameworkPaths)}\n`
      : "";

  if (frameworkPaths.length === 0) {
    console.warn("[phone11-pjsip-patch] No iOS vendored frameworks found under react-native-pjsip/ios.");
  }

  const source = `require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "react-native-pjsip"
  s.version      = package["version"]
  s.summary      = package["description"] || "PJSIP module for React Native"
  s.homepage     = package["homepage"] || "https://github.com/datso/react-native-pjsip"
  s.license      = { :type => package["license"] || "MIT" }
  s.authors      = { "react-native-pjsip" => "support@phone11.ai" }
  s.platforms    = { :ios => "13.0" }
  s.source       = { :git => "https://github.com/datso/react-native-pjsip.git", :tag => "v#{s.version}" }
  s.source_files = "ios/RTCPjSip/*.{h,m,mm}"
  s.public_header_files = "ios/RTCPjSip/*.h"
  s.header_mappings_dir = "ios/RTCPjSip"
${vendoredFrameworks}  s.frameworks = "AVFoundation", "AudioToolbox", "CallKit", "CoreMedia", "CoreVideo", "VideoToolbox"
  s.libraries = "c++", "z"
  s.pod_target_xcconfig = {
    "GCC_PREPROCESSOR_DEFINITIONS" => "$(inherited) PJ_AUTOCONF=1",
    "FRAMEWORK_SEARCH_PATHS" => '$(inherited) "${PODS_TARGET_SRCROOT}/ios"',
    "HEADER_SEARCH_PATHS" => '$(inherited) "${PODS_TARGET_SRCROOT}/ios/VialerPJSIP.framework/Headers"',
    "OTHER_LDFLAGS" => "$(inherited) -ObjC"
  }
  s.requires_arc = true
  s.dependency "React-Core"
end
`;

  const existing = await readIfExists(podspecPath);
  if (existing === source) {
    console.log(`[phone11-pjsip-patch] iOS podspec already present: ${podspecPath}`);
    return false;
  }

  await writeFile(podspecPath, source);
  console.log(
    `[phone11-pjsip-patch] Wrote iOS podspec: ${podspecPath}; vendored_frameworks=${frameworkPaths.join(", ") || "none"}`
  );
  return true;
}

async function ensurePjSipBridgeExport() {
  const source = await readIfExists(iosModulePath);
  if (source === null) {
    console.warn(`[phone11-pjsip-patch] Skipping iOS bridge export; missing ${iosModulePath}`);
    return false;
  }

  let next = source;

  if (!next.includes(iosBridgeHeaderImport)) {
    next = next.replace(/(#import\s+<React\/RCTBridge\.h>\s*)/, `$1${iosBridgeHeaderImport}\n`);
  }

  if (!/RCT_EXPORT_MODULE\s*\(/.test(next)) {
    if (!/@implementation\s+PjSipModule\b/.test(next)) {
      throw new Error(
        `[phone11-pjsip-patch] Cannot add RCT_EXPORT_MODULE because @implementation PjSipModule was not found in ${iosModulePath}`
      );
    }

    next = next.replace(
      /(@implementation\s+PjSipModule(?:\s*\([^)]*\))?\s*)/,
      "$1\nRCT_EXPORT_MODULE(PjSipModule);\n"
    );
  }

  if (!/RCT_EXPORT_MODULE\s*\(/.test(next)) {
    throw new Error(`[phone11-pjsip-patch] PjSipModule legacy bridge export is still missing in ${iosModulePath}`);
  }

  if (next !== source) {
    await writeFile(iosModulePath, next);
    console.log(`[phone11-pjsip-patch] Wrote iOS PjSipModule legacy bridge export: ${iosModulePath}`);
  }

  console.log(`[phone11-pjsip-patch] Verified iOS PjSipModule legacy bridge export: ${iosModulePath}`);
  return next !== source;
}

const podspecChanged = await ensurePjSipPodspec();
const iosModuleChanged = await ensurePjSipBridgeExport();

const manifestSource = await readIfExists(manifestPath);
const manifestPackage = manifestSource?.match(/<manifest\b[^>]*\s+package=["']([^"']+)["']/)?.[1];
const namespace = manifestPackage || fallbackNamespace;
const escapedNamespace = namespace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const gradleChanged = await patchFile(gradlePath, (source) => {
  let next = source
    .replace(/\bcompile\s+(["'])com\.facebook\.react:react-native:\+\1/g, 'implementation "com.facebook.react:react-android"')
    .replace(/\bcompile\s+project\(/g, "implementation project(")
    .replace(/\bcompile\s+fileTree\(/g, "implementation fileTree(")
    .replace(/\bcompile\s+/g, "implementation ")
    .replace(/\bcompileSdkVersion\s+\d+/g, "compileSdkVersion rootProject.ext.compileSdkVersion")
    .replace(/\btargetSdkVersion\s+\d+/g, "targetSdkVersion rootProject.ext.targetSdkVersion")
    .replace(/\bcompileSdk\s+\d+/g, "compileSdk rootProject.ext.compileSdkVersion")
    .replace(/\btargetSdk\s+\d+/g, "targetSdk rootProject.ext.targetSdkVersion")
    .replace(/\n\s*implementation\s+["']androidx\.annotation:annotation:[^"']+["']\s*/g, "\n");

  if (/android\s*\{/.test(next) && !new RegExp(`\\bnamespace\\s+["']${escapedNamespace}["']`).test(next)) {
    next = next.replace(/android\s*\{\s*/, (match) => `${match}\n    namespace "${namespace}"\n`);
  }

  if (!/androidx\.annotation:annotation/.test(next)) {
    const dependencyBlockMatches = [...next.matchAll(/dependencies\s*\{/g)];
    const projectDependencyBlock =
      dependencyBlockMatches.length > 1
        ? dependencyBlockMatches[dependencyBlockMatches.length - 1]
        : null;

    if (projectDependencyBlock?.index !== undefined) {
      const insertAt = projectDependencyBlock.index + projectDependencyBlock[0].length;
      next =
        next.slice(0, insertAt) +
        '\n    implementation "androidx.annotation:annotation:1.9.1"' +
        next.slice(insertAt);
    } else {
      next += '\n\ndependencies {\n    implementation "androidx.annotation:annotation:1.9.1"\n}\n';
    }
  }

  return next;
});

const manifestChanged = await patchFile(manifestPath, (source) =>
  source.replace(/(<manifest\b[^>]*?)\s+package=["'][^"']+["']([^>]*>)/, "$1$2")
);
const sourceChanged = await patchSourceTree(sourceRoot);

if (podspecChanged || iosModuleChanged || gradleChanged || manifestChanged || sourceChanged) {
  console.log("[phone11-pjsip-patch] Patched react-native-pjsip iOS/Android native config.");
} else {
  console.log("[phone11-pjsip-patch] react-native-pjsip native config already patched.");
}
