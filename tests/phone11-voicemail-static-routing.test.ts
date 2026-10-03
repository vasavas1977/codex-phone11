import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SaxesParser } from "saxes";

describe("static voicemail entry coverage", () => {
  it("has only guarded deposit entries while retaining voicemail check access", () => {
    const xml = readFileSync("deploy/freeswitch/dialplan/cloudphone11.xml", "utf8");
    const applications: { application: string; data?: string }[] = [];
    const parser = new SaxesParser();
    parser.on("opentag", tag => {
      if (tag.name === "action") applications.push(tag.attributes as { application: string; data?: string });
    });
    parser.write(xml).close();
    expect(applications.filter(action => action.application === "voicemail")).toEqual([
      { application: "voicemail", data: "check default ${domain_name} ${caller_id_number}" },
    ]);
    expect(applications.filter(action => action.application === "lua" && action.data?.includes("phone11_legacy_voicemail.lua"))
      .map(action => action.data)).toEqual([
      "/etc/freeswitch/scripts/phone11_legacy_voicemail.lua $1 ${domain_name} answer",
      "/etc/freeswitch/scripts/phone11_legacy_voicemail.lua 7001 ${domain_name}",
      "/etc/freeswitch/scripts/phone11_legacy_voicemail.lua 7002 ${domain_name}",
    ]);
  });
  it("propagates the same hook flag to the FreeSWITCH process with a false default", () => {
    expect(readFileSync("deploy/freeswitch/docker-compose.yml", "utf8"))
      .toContain("PHONE11_VOICEMAIL_HOOK_READY: ${PHONE11_VOICEMAIL_HOOK_READY:-false}");
  });
});

describe("bundled route indirections and packaging", () => {
  it("guards both default dialplan voicemail loopback entries", () => {
    const xml = readFileSync("infra/configs/freeswitch/dialplan/default.xml", "utf8");
    const actions: { application: string; data?: string }[] = [];
    const parser = new SaxesParser();
    parser.on("opentag", tag => { if (tag.name === "action") actions.push(tag.attributes as { application: string; data?: string }); });
    parser.write(xml).close();
    expect(actions.filter(action => action.data?.includes("app=voicemail"))).toEqual([]);
    expect(actions.filter(action => action.application === "voicemail").every(action => action.data?.startsWith("check "))).toBe(true);
    expect(actions.filter(action => action.data === "/etc/freeswitch/scripts/phone11_legacy_voicemail.lua ${dialed_extension} ${domain_name} loopback")).toHaveLength(2);
  });
  it("packages matching versions of both helpers in each mounted scripts tree", () => {
    for (const helper of ["phone11_legacy_voicemail.lua", "phone11_voicemail_deposit.lua"]) {
      expect(readFileSync(`deploy/freeswitch/scripts/${helper}`, "utf8"))
        .toBe(readFileSync(`infra/configs/freeswitch/scripts/${helper}`, "utf8"));
    }
  });
  it.each(["dev", "prod"])("mounts the helpers and propagates a default-off flag in infrastructure %s", mode => {
    const compose = readFileSync(`infra/compose/docker-compose.${mode}.yml`, "utf8");
    const service = compose.split("  freeswitch:\n")[1].split(/\n  [a-zA-Z][^\n]*:\n/)[0];
    expect(service).toContain("PHONE11_VOICEMAIL_HOOK_READY: ${PHONE11_VOICEMAIL_HOOK_READY:-false}");
    expect(service).toContain("../configs/freeswitch:/etc/freeswitch:ro");
  });
});

describe("guarded-deposit interpreter packaging", () => {
  it("explicitly installs and verifies the Lua module used by mounted routes", () => {
    const dockerfile = readFileSync("infra/docker/freeswitch/Dockerfile", "utf8").replace(/\\\r?\n/g, " ");
    const moduleInstall = dockerfile.split("\n").find(line => line.startsWith("RUN apt-get update") && line.includes("freeswitch-mod-voicemail"));
    expect(moduleInstall).toContain("--no-install-recommends");
    expect(moduleInstall?.split(/\s+/)).toContain("freeswitch-mod-lua");
    expect(dockerfile).toContain("RUN test -r /usr/lib/freeswitch/mod/mod_lua.so");
    const modules: string[] = [];
    const parser = new SaxesParser();
    parser.on("opentag", tag => { if (tag.name === "load") modules.push(String(tag.attributes.module)); });
    parser.write(readFileSync("infra/configs/freeswitch/autoload_configs/modules.conf.xml", "utf8")).close();
    expect(modules).toContain("mod_lua");
  });
});
