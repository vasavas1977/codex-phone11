import { describe, expect, it } from "vitest";
import { repairNativeSdpAnswer } from "../scripts/phone11-native-sdp-repair.mjs";

const fixture = String.raw`unrelated_config();
onreply_route[FREESWITCH_REPLY] {
  rtpengine_answer("media-address=43.210.122.111 direction=priv direction=pub");
  if ($avp(phone11_media_profile) == "native" && $rb =~ "10\.0\.1\.69") {
    subst_body('/10\.0\.1\.69/43.210.122.111/g');
    xlog("L_ALERT", "FORCED_PUBLIC_NATIVE_ANSWER_SDP public_media_ip=43.210.122.111");
  }
  if ($avp(phone11_media_profile) == "native" && has_body("application/sdp")) {
    subst_body('/10\.0\.1\.69/43.210.122.111/g');
    xlog("L_ALERT", "FORCED_PUBLIC_NATIVE_ANSWER_SDP_V5 public_media_ip=43.210.122.111");
  }
}
# ---- Failure Route ----
unrelated_failure();`;

describe("Native SDP answer repair", () => {
  it("leaves public addressing to RTPengine and preserves unrelated configuration", () => {
    const result = repairNativeSdpAnswer(fixture);
    expect(result).not.toContain("subst_body(");
    expect(result).toContain('rtpengine_answer("media-address=43.210.122.111 direction=priv direction=pub");');
    expect(result.startsWith("unrelated_config();")).toBe(true);
    expect(result.endsWith("unrelated_failure();")).toBe(true);
  });
  it("is idempotent", () => {
    const result = repairNativeSdpAnswer(fixture);
    expect(repairNativeSdpAnswer(result)).toBe(result);
  });
  it("refuses drifted routes, missing public addressing, or unexpected rewrites", () => {
    expect(() => repairNativeSdpAnswer("different config")).toThrow();
    expect(() => repairNativeSdpAnswer(fixture.replace("media-address=43.210.122.111", ""))).toThrow();
    expect(() => repairNativeSdpAnswer(fixture.replace("subst_body('/10", "subst_body('/11"))).toThrow();
    expect(() => repairNativeSdpAnswer(fixture.replace('}\n# ---- Failure', 'subst_body("unexpected");\n}\n# ---- Failure'))).toThrow();
  });
});
