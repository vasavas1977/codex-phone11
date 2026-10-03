import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = readFileSync("infra/configs/kamailio/kamailio.cfg", "utf8");
const dockerfile = readFileSync("infra/docker/kamailio/Dockerfile", "utf8");
const didRoute = config.slice(
  config.indexOf("route[DID_ROUTE]"),
  config.indexOf("route[TO_FREESWITCH]"),
);
const authRoute = config.slice(
  config.indexOf("route[AUTH]"),
  config.indexOf("route[RTPENGINE_MANAGE]"),
);
const inviteRoute = config.slice(
  config.indexOf("route[INVITE]"),
  config.indexOf("route[DID_ROUTE]"),
);

describe("Kamailio DID backend contract", () => {
  it("posts the numeric DID as JSON with the integration secret in a header", () => {
    expect(dockerfile).toContain(
      "ghcr.io/kamailio/kamailio:5.8.8-bookworm@sha256:c34cad7d31b72a715d5cc37c7fd63fde5b555a41bcae4a362b2ce6d902c0395b",
    );
    expect(didRoute).toContain(
      '$var(api_url) = "BACKEND_URL/api/kamailio/route"',
    );
    expect(didRoute).toContain(
      '$var(api_body) = "{\\"ruri_user\\":\\"" + $rU + "\\"}"',
    );
    expect(didRoute).toContain("x-kam-secret: KAM_SECRET");
    expect(didRoute).toContain(
      'http_client_query("$var(api_url)", "$var(api_body)", "$var(api_headers)", "$var(api_result)")',
    );
    expect(didRoute).not.toContain("http_client_request(");
    expect(didRoute).not.toMatch(/[?&](secret|token)=/);
  });

  it("uses the parser-tested vendor image and drops root at runtime", () => {
    expect(dockerfile).toContain("ARG KAMAILIO_PLATFORM=linux/amd64");
    expect(dockerfile).toContain("USER kamailio");
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/sbin/kamailio"]');
    expect(dockerfile).not.toContain("deb.kamailio.org");
    expect(dockerfile).not.toContain("apt-get");
  });

  it("bounds DID route changes to a short pilot cache interval", () => {
    expect(config).toContain('did_cache=>size=8;autoexpire=30;');
    expect(config).not.toContain("autoexpire=300");
  });

  it("allowlists extension URIs and internal PBX targets before routing", () => {
    expect(didRoute).toContain("^sip:[0-9]{2,10}@[A-Za-z0-9.-]+$");
    expect(didRoute).toContain(
      "^phone11pbx-(ivr|ringgroup|queue|timecondition|ringall)-",
    );
    expect(didRoute).toContain('sl_send_reply("404", "Not Found")');

    const freeSwitchAssignment = didRoute.indexOf("$rU = $var(did_target)");
    const internalAllowlist = didRoute.indexOf(
      "^phone11pbx-(ivr|ringgroup|queue|timecondition|ringall)-",
    );
    expect(freeSwitchAssignment).toBeGreaterThan(internalAllowlist);
  });

  it("fails closed when the backend cannot resolve an inbound DID", () => {
    const failureBranch = didRoute.slice(
      didRoute.indexOf("if ($rc == 200)"),
      didRoute.indexOf("# Only use"),
    );
    expect(failureBranch).toContain(
      'sl_send_reply("503", "Routing Temporarily Unavailable")',
    );
    expect(failureBranch).not.toContain("route(TO_FREESWITCH)");
  });

  it("sends authenticated Phone11 numeric calls outbound and carrier numeric calls through DID lookup", () => {
    expect(config).toContain("alias=MY_DOMAIN");
    const numericBranch = inviteRoute.slice(
      inviteRoute.indexOf('if ($rU =~ "^\\+?[0-9]{9,15}$")'),
      inviteRoute.indexOf("# Unknown destination"),
    );
    expect(numericBranch).toMatch(
      /if \(from_uri == myself\)[\s\S]*route\(TO_FREESWITCH\);[\s\S]*route\(DID_ROUTE\);/,
    );
    expect(config.indexOf("route(AUTH)")).toBeLessThan(
      config.indexOf("route(INVITE)"),
    );
    expect(authRoute).toContain(
      'if (is_method("REGISTER") || from_uri == myself)',
    );
    expect(authRoute).toContain('auth_check("MY_DOMAIN", "subscriber", "1")');
    expect(authRoute).toContain('auth_challenge("MY_DOMAIN", "1")');
  });

  it("does not cache an HTTP 200 rejection without an allowlisted target", () => {
    const parsedResponse = didRoute.slice(
      didRoute.indexOf('jansson_get("target"'),
      didRoute.indexOf("# Only use"),
    );
    expect(parsedResponse).not.toContain("$sht(did_cache=>$rU) =");
    expect(
      didRoute.indexOf("$sht(did_cache=>$rU) =", didRoute.indexOf("# Only use")),
    ).toBeGreaterThan(didRoute.indexOf("^sip:[0-9]{2,10}@[A-Za-z0-9.-]+$"));
  });
});
