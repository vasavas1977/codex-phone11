const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

function wakeOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Phone11 wake requires an HTTPS API origin without a path or credentials");
  }
  return url.origin;
}

function injectBootstrap(source) {
  const marker = "// Phone11 native incoming wake bootstrap (commissioning gate remains native-only).";
  // Match the declaration's complete parameter list. A call to super.application
  // also contains didFinishLaunchingWithOptions and must never consume the next
  // linking method's return type/body as a second launch signature.
  const launch = /\b(?:public\s+)?override\s+func\s+application\s*\(\s*_\s+application\s*:\s*UIApplication\s*,\s*didFinishLaunchingWithOptions\s+launchOptions\s*:\s*\[\s*UIApplication\.LaunchOptionsKey\s*:\s*Any\s*\]\s*\?\s*=\s*nil\s*\)\s*->\s*Bool\s*\{/g;
  const matches = [...source.matchAll(launch)];
  if (matches.length !== 1) throw new Error("Phone11 requires the reviewed Swift AppDelegate launch signature");
  const bodyStart = matches[0].index + matches[0][0].length;
  const injection = `\n    ${marker}\n    Phone11VoipPush.bootstrap()`;
  const imports = [...source.matchAll(/^import Phone11Siprix\s*$/gm)];
  if (source.includes(marker) || source.includes("Phone11VoipPush.bootstrap()")) {
    if (source.split(marker).length !== 2 || source.split("Phone11VoipPush.bootstrap()").length !== 2 ||
        !source.slice(bodyStart).startsWith(injection) || imports.length !== 1) {
      throw new Error("Phone11 found an incomplete or misplaced native wake bootstrap");
    }
    return source;
  }
  if (imports.length > 1) throw new Error("Phone11 found duplicate native wake imports");
  const result = source.slice(0, bodyStart) + injection + source.slice(bodyStart);
  return imports.length ? result : `import Phone11Siprix\n${result}`;
}

function withPhone11VoipWake(config, options = {}) {
  const origin = wakeOrigin(options.origin ?? "https://api.phone11.ai");
  config = withInfoPlist(config, native => { native.modResults.Phone11WakeOrigin = origin; return native; });
  return withAppDelegate(config, native => {
    if (native.modResults.language !== "swift") throw new Error("Phone11 wake bootstrap requires Swift AppDelegate");
    native.modResults.contents = injectBootstrap(native.modResults.contents);
    return native;
  });
}
module.exports = withPhone11VoipWake;
module.exports.injectBootstrap = injectBootstrap;
module.exports.wakeOrigin = wakeOrigin;
