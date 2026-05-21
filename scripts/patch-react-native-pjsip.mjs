import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const packageRoot = path.join(process.cwd(), "node_modules", "react-native-pjsip");
const podspecPath = path.join(packageRoot, "react-native-pjsip.podspec");
const iosRoot = path.join(packageRoot, "ios");
const iosModulePath = path.join(iosRoot, "RTCPjSip", "PjSipModule.m");
const iosAccountPath = path.join(iosRoot, "RTCPjSip", "PjSipAccount.m");
const iosCallPath = path.join(iosRoot, "RTCPjSip", "PjSipCall.m");
const iosUtilPath = path.join(iosRoot, "RTCPjSip", "PjSipUtil.m");
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
    "FRAMEWORK_SEARCH_PATHS" => '$(inherited) "\${PODS_TARGET_SRCROOT}/ios"',
    "HEADER_SEARCH_PATHS" => '$(inherited) "\${PODS_TARGET_SRCROOT}/ios/VialerPJSIP.framework/Headers"',
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

async function ensurePjSipRegistrationPayload() {
  const source = await readIfExists(iosAccountPath);
  if (source === null) {
    console.warn(`[phone11-pjsip-patch] Skipping iOS registration payload patch; missing ${iosAccountPath}`);
    return false;
  }

  if (source.includes('@"active": @(registrationActive)')) {
    console.log(`[phone11-pjsip-patch] Verified iOS registration payload patch: ${iosAccountPath}`);
    return false;
  }

  const legacyBlock = `    // Format registration status
    NSDictionary * registration = @{
        @"status": [PjSipUtil toString:(pj_str_t *) pjsip_get_status_text(info.status)],
        @"statusText": [PjSipUtil toString:&info.status_text],
        @"active": @"test",
        @"reason": @"test"
    };
`;

  const patchedBlock = `    NSString *statusText = [PjSipUtil toString:&info.status_text];
    if (statusText == nil || [statusText length] == 0) {
        statusText = [PjSipUtil toString:(pj_str_t *) pjsip_get_status_text(info.status)];
    }
    NSString *defaultReason = [PjSipUtil toString:(pj_str_t *) pjsip_get_status_text(info.status)];
    BOOL registrationActive = info.has_registration == PJ_TRUE && info.expires > 0 && info.status == PJSIP_SC_OK;

    NSDictionary * registration = @{
        @"status": @(info.status),
        @"statusText": statusText ?: @"",
        @"active": @(registrationActive),
        @"reason": statusText ?: defaultReason ?: @"",
        @"expires": @(info.expires),
        @"hasRegistration": @(info.has_registration == PJ_TRUE),
        @"lastError": @(info.reg_last_err)
    };
`;

  if (!source.includes(legacyBlock)) {
    throw new Error(
      `[phone11-pjsip-patch] Could not locate the legacy iOS registration payload block in ${iosAccountPath}`
    );
  }

  await writeFile(iosAccountPath, source.replace(legacyBlock, patchedBlock));
  console.log(`[phone11-pjsip-patch] Wrote iOS registration payload patch: ${iosAccountPath}`);
  return true;
}

async function ensurePjSipAudioCallbacks() {
  const source = await readIfExists(iosModulePath);
  if (source === null) {
    console.warn(`[phone11-pjsip-patch] Skipping iOS audio callback patch; missing ${iosModulePath}`);
    return false;
  }

  if (
    source.includes('callback(@[@TRUE, @"speaker"]);') &&
    source.includes('callback(@[@TRUE, @"earpiece"]);') &&
    source.includes('callback(@[@TRUE, @"audioSessionActivated"]);') &&
    source.includes('callback(@[@TRUE, @"audioSessionDeactivated"]);')
  ) {
    console.log(`[phone11-pjsip-patch] Verified iOS audio callback patch: ${iosModulePath}`);
    return false;
  }

  const replacements = [
    [
      `RCT_EXPORT_METHOD(useSpeaker: (int) callId callback:(RCTResponseSenderBlock) callback) {
    [[PjSipEndpoint instance] useSpeaker];
}
`,
      `RCT_EXPORT_METHOD(useSpeaker: (int) callId callback:(RCTResponseSenderBlock) callback) {
    [[PjSipEndpoint instance] useSpeaker];
    callback(@[@TRUE, @"speaker"]);
}
`,
    ],
    [
      `RCT_EXPORT_METHOD(useEarpiece: (int) callId callback:(RCTResponseSenderBlock) callback) {
    [[PjSipEndpoint instance] useEarpiece];
}
`,
      `RCT_EXPORT_METHOD(useEarpiece: (int) callId callback:(RCTResponseSenderBlock) callback) {
    [[PjSipEndpoint instance] useEarpiece];
    callback(@[@TRUE, @"earpiece"]);
}
`,
    ],
    [
      `RCT_EXPORT_METHOD(activateAudioSession: (RCTResponseSenderBlock) callback) {
    pjsua_set_no_snd_dev();
    pj_status_t status;
    status = pjsua_set_snd_dev(PJMEDIA_AUD_DEFAULT_CAPTURE_DEV, PJMEDIA_AUD_DEFAULT_PLAYBACK_DEV);
    if (status != PJ_SUCCESS) {
        NSLog(@"Failed to active audio session");
    }
}
`,
      `RCT_EXPORT_METHOD(activateAudioSession: (RCTResponseSenderBlock) callback) {
    pjsua_set_no_snd_dev();
    pj_status_t status;
    status = pjsua_set_snd_dev(PJMEDIA_AUD_DEFAULT_CAPTURE_DEV, PJMEDIA_AUD_DEFAULT_PLAYBACK_DEV);
    if (status != PJ_SUCCESS) {
        NSLog(@"Failed to activate audio session (%d)", status);
        callback(@[@FALSE, [NSString stringWithFormat:@"Failed to activate audio session (%d)", status]]);
        return;
    }
    callback(@[@TRUE, @"audioSessionActivated"]);
}
`,
    ],
    [
      `RCT_EXPORT_METHOD(deactivateAudioSession: (RCTResponseSenderBlock) callback) {
    pjsua_set_no_snd_dev();
}
`,
      `RCT_EXPORT_METHOD(deactivateAudioSession: (RCTResponseSenderBlock) callback) {
    pjsua_set_no_snd_dev();
    callback(@[@TRUE, @"audioSessionDeactivated"]);
}
`,
    ],
  ];

  let next = source;
  for (const [legacyBlock, patchedBlock] of replacements) {
    if (!next.includes(legacyBlock)) {
      throw new Error(
        `[phone11-pjsip-patch] Could not locate the legacy iOS audio callback block in ${iosModulePath}`
      );
    }
    next = next.replace(legacyBlock, patchedBlock);
  }

  await writeFile(iosModulePath, next);
  console.log(`[phone11-pjsip-patch] Wrote iOS audio callback patch: ${iosModulePath}`);
  return true;
}

async function ensurePjSipSafeStringConversion() {
  const source = await readIfExists(iosUtilPath);
  if (source === null) {
    console.warn(`[phone11-pjsip-patch] Skipping iOS safe string patch; missing ${iosUtilPath}`);
    return false;
  }

  if (source.includes("Phone11 safe pj_str_t conversion")) {
    console.log(`[phone11-pjsip-patch] Verified iOS safe string patch: ${iosUtilPath}`);
    return false;
  }

  const legacyPattern =
    /\+ \(NSString \*\) toString : \(pj_str_t \*\)pjStr \{\n\s*if \(pjStr->slen < 0\) \{\n\s*return \[NSNull null\];\n\s*\}\n\s*return \[\[NSString alloc\]\n\s*initWithBytes:pjStr->ptr\n\s*length:pjStr->slen\n\s*encoding:NSUTF8StringEncoding\];\n\}\n/;

  const patchedBlock = `+ (NSString *) toString : (pj_str_t *)pjStr {
    // Phone11 safe pj_str_t conversion: event payloads are emitted from native
    // PJSIP callbacks, so never allow an invalid string to crash the app.
    if (pjStr == NULL || pjStr->slen < 0 || pjStr->ptr == NULL) {
        return [NSNull null];
    }
    if (pjStr->slen == 0) {
        return @"";
    }

    NSString *value = [[NSString alloc]
            initWithBytes:pjStr->ptr
                   length:pjStr->slen
                 encoding:NSUTF8StringEncoding];

    return value ?: [NSNull null];
}
`;

  if (!legacyPattern.test(source)) {
    throw new Error(
      `[phone11-pjsip-patch] Could not locate the legacy safe string block in ${iosUtilPath}`
    );
  }

  await writeFile(iosUtilPath, source.replace(legacyPattern, patchedBlock));
  console.log(`[phone11-pjsip-patch] Wrote iOS safe string patch: ${iosUtilPath}`);
  return true;
}

async function ensurePjSipMediaBridgeSafety() {
  const source = await readIfExists(iosCallPath);
  if (source === null) {
    console.warn(`[phone11-pjsip-patch] Skipping iOS media bridge patch; missing ${iosCallPath}`);
    return false;
  }

  if (source.includes("Phone11 media bridge diagnostics")) {
    console.log(`[phone11-pjsip-patch] Verified iOS media bridge patch: ${iosCallPath}`);
    return false;
  }

  const legacyPattern =
    /- \(void\)onMediaStateChanged:\(pjsua_call_info\)info \{\n\s*pjsua_call_media_status status = info\.media_status;\n\s*if \(status == PJSUA_CALL_MEDIA_ACTIVE \|\| status == PJSUA_CALL_MEDIA_REMOTE_HOLD\) \{\n\s*pjsua_conf_connect\(info\.conf_slot, 0\);\n\s*pjsua_conf_connect\(0, info\.conf_slot\);\n\s*\}\n\}\n/;

  const patchedBlock = `- (void)onMediaStateChanged:(pjsua_call_info)info {
    // Phone11 media bridge diagnostics: connect every active audio stream and
    // log native status codes instead of crashing silently at PSTN answer time.
    pjsua_call_media_status status = info.media_status;
    NSLog(@"[Phone11PJSIP] media_state call=%d media_status=%d conf_slot=%d media_cnt=%u",
          self.id, status, info.conf_slot, info.media_cnt);

    if (status != PJSUA_CALL_MEDIA_ACTIVE && status != PJSUA_CALL_MEDIA_REMOTE_HOLD) {
        return;
    }

    BOOL connectedAudio = NO;
    for (unsigned i = 0; i < info.media_cnt; i++) {
        pjsua_call_media_info media = info.media[i];
        if (media.type != PJMEDIA_TYPE_AUDIO ||
            (media.status != PJSUA_CALL_MEDIA_ACTIVE && media.status != PJSUA_CALL_MEDIA_REMOTE_HOLD)) {
            continue;
        }

        pjsua_conf_port_id slot = media.stream.aud.conf_slot;
        if (slot == PJSUA_INVALID_ID) {
            NSLog(@"[Phone11PJSIP] skip invalid audio conf slot call=%d media=%u", self.id, i);
            continue;
        }

        pj_status_t toDevice = pjsua_conf_connect(slot, 0);
        pj_status_t fromDevice = pjsua_conf_connect(0, slot);
        NSLog(@"[Phone11PJSIP] audio_bridge call=%d media=%u slot=%d to_device=%d from_device=%d",
              self.id, i, slot, toDevice, fromDevice);
        connectedAudio = YES;
    }

    if (!connectedAudio && info.conf_slot != PJSUA_INVALID_ID) {
        pj_status_t toDevice = pjsua_conf_connect(info.conf_slot, 0);
        pj_status_t fromDevice = pjsua_conf_connect(0, info.conf_slot);
        NSLog(@"[Phone11PJSIP] fallback_audio_bridge call=%d slot=%d to_device=%d from_device=%d",
              self.id, info.conf_slot, toDevice, fromDevice);
    }
}
`;

  if (!legacyPattern.test(source)) {
    throw new Error(
      `[phone11-pjsip-patch] Could not locate the legacy iOS media bridge block in ${iosCallPath}`
    );
  }

  await writeFile(iosCallPath, source.replace(legacyPattern, patchedBlock));
  console.log(`[phone11-pjsip-patch] Wrote iOS media bridge patch: ${iosCallPath}`);
  return true;
}

const podspecChanged = await ensurePjSipPodspec();
const iosModuleChanged = await ensurePjSipBridgeExport();
const iosAccountChanged = await ensurePjSipRegistrationPayload();
const iosAudioChanged = await ensurePjSipAudioCallbacks();
const iosStringChanged = await ensurePjSipSafeStringConversion();
const iosMediaChanged = await ensurePjSipMediaBridgeSafety();

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

if (
  podspecChanged ||
  iosModuleChanged ||
  iosAccountChanged ||
  iosAudioChanged ||
  iosStringChanged ||
  iosMediaChanged ||
  gradleChanged ||
  manifestChanged ||
  sourceChanged
) {
  console.log("[phone11-pjsip-patch] Patched react-native-pjsip iOS/Android native config.");
} else {
  console.log("[phone11-pjsip-patch] react-native-pjsip native config already patched.");
}
