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
  if (source.includes(marker)) return source;
  const launch = /(didFinishLaunchingWithOptions[\s\S]*?\)\s*->\s*Bool\s*\{)/g;
  if ([...source.matchAll(launch)].length !== 1) throw new Error("Phone11 requires the reviewed Swift AppDelegate launch signature");
  return `import Phone11Siprix\n${source}`.replace(launch, `$1\n    ${marker}\n    Phone11VoipPush.bootstrap()`);
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
