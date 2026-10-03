import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const eas = JSON.parse(readFileSync(new URL("../eas.json", import.meta.url), "utf8"));
const productionBundle = "space.manus.phone11ai.t20260425073427";

test("no development-client profile can replace the signed Phone11 app", () => {
  for (const [name, profile] of Object.entries(eas.build)) {
    if (!profile.developmentClient) continue;
    assert.notEqual(
      profile.env?.PHONE11_BUNDLE_ID,
      productionBundle,
      `${name} must never use the production Phone11 bundle identifier`,
    );
  }
});

test("the daily handset profile is a standalone internal Phone11 build", () => {
  const profile = eas.build["preview-ios-siprix-daily-pilot"];
  assert.equal(profile.extends, "preview-ios-siprix-wake-pilot");
  assert.equal(profile.channel, "siprix-daily-pilot");
  assert.notEqual(profile.developmentClient, true);

  const identity = eas.build["preview-ios-existing-credentials"];
  assert.equal(identity.distribution, "internal");
  assert.equal(identity.env.PHONE11_BUNDLE_ID, productionBundle);
});
