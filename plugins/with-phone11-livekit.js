const { withAppDelegate, withMainApplication } = require("expo/config-plugins");

const iosImport = "import livekit_react_native";
const androidImports = [
  "import com.livekit.reactnative.LiveKitReactNative",
  "import com.livekit.reactnative.audio.AudioType",
];
const iosMarker = "// Phone11 native LiveKit setup (RN3 namespaced WebRTC).";
const androidMarker = "// Phone11 native LiveKit setup (RN3 namespaced WebRTC).";

function addImport(source, value) {
  if (source.includes(value)) return source;
  const imports = [...source.matchAll(/^import\s+[^\n]+$/gm)];
  if (imports.length === 0) throw new Error("Phone11 LiveKit could not find native imports");
  const last = imports.at(-1);
  const at = last.index + last[0].length;
  return `${source.slice(0, at)}\n${value}${source.slice(at)}`;
}

function injectIosSetup(source) {
  source = addImport(source, iosImport);
  const launch = /\b(?:public\s+)?override\s+func\s+application\s*\(\s*_\s+application\s*:\s*UIApplication\s*,\s*didFinishLaunchingWithOptions\s+launchOptions\s*:\s*\[\s*UIApplication\.LaunchOptionsKey\s*:\s*Any\s*\]\s*\?\s*=\s*nil\s*\)\s*->\s*Bool\s*\{/g;
  const matches = [...source.matchAll(launch)];
  if (matches.length !== 1) throw new Error("Phone11 LiveKit requires the reviewed Swift launch signature");
  if (source.includes(iosMarker)) return source;
  const at = matches[0].index + matches[0][0].length;
  const injected = `\n    ${iosMarker}\n    LivekitReactNative.setup()`;
  return `${source.slice(0, at)}${injected}${source.slice(at)}`;
}

function injectAndroidSetup(source) {
  for (const value of androidImports) source = addImport(source, value);
  const onCreate = /override\s+fun\s+onCreate\s*\(\s*\)\s*\{/g;
  const matches = [...source.matchAll(onCreate)];
  if (matches.length !== 1) throw new Error("Phone11 LiveKit requires the generated Android onCreate method");
  if (source.includes(androidMarker)) return source;
  const at = matches[0].index + matches[0][0].length;
  const injected = `\n    ${androidMarker}\n    LiveKitReactNative.setup(this, AudioType.CommunicationAudioType())`;
  return `${source.slice(0, at)}${injected}${source.slice(at)}`;
}

function withPhone11LiveKit(config) {
  config = withAppDelegate(config, (native) => {
    if (native.modResults.language !== "swift") throw new Error("Phone11 LiveKit requires a Swift AppDelegate");
    native.modResults.contents = injectIosSetup(native.modResults.contents);
    return native;
  });
  return withMainApplication(config, (native) => {
    if (native.modResults.language !== "kt") throw new Error("Phone11 LiveKit requires a Kotlin MainApplication");
    native.modResults.contents = injectAndroidSetup(native.modResults.contents);
    return native;
  });
}

module.exports = withPhone11LiveKit;
module.exports.injectIosSetup = injectIosSetup;
module.exports.injectAndroidSetup = injectAndroidSetup;
