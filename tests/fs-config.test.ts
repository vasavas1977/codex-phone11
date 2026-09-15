import { describe, expect, it } from "vitest";
import { getFreeSwitchConfig } from "../server/pbx/fs-config";

describe("FreeSWITCH deployment configuration", () => {
  it("reads the environment names used by Docker Compose and Kubernetes", () => {
    expect(getFreeSwitchConfig({
      NODE_ENV: "production",
      FREESWITCH_ESL_HOST: "freeswitch",
      FREESWITCH_ESL_PORT: "8022",
      FREESWITCH_ESL_PASSWORD: "test-only-secret",
    })).toEqual({ host: "freeswitch", port: 8022, password: "test-only-secret" });
  });

  it("supports existing FS_ESL deployments", () => {
    expect(getFreeSwitchConfig({
      NODE_ENV: "production",
      FS_ESL_HOST: "10.0.1.69",
      FS_ESL_PASSWORD: "test-only-secret",
    })).toEqual({ host: "10.0.1.69", port: 8021, password: "test-only-secret" });
  });

  it("gives the documented deployment names precedence", () => {
    expect(getFreeSwitchConfig({
      FREESWITCH_ESL_HOST: "freeswitch",
      FREESWITCH_ESL_PORT: "8022",
      FREESWITCH_ESL_PASSWORD: "current-test-secret",
      FS_ESL_HOST: "obsolete-host",
      FS_ESL_PORT: "8023",
      FS_ESL_PASSWORD: "obsolete-test-secret",
    })).toEqual({ host: "freeswitch", port: 8022, password: "current-test-secret" });
  });

  it.each(["0", "-1", "65536", "8021oops", "8021.5", "NaN"])(
    "rejects an invalid port: %s", (port) => {
      expect(() => getFreeSwitchConfig({ FREESWITCH_ESL_PORT: port }))
        .toThrow("FreeSWITCH ESL port");
    },
  );

  it.each([
    { NODE_ENV: "production" },
    { NODE_ENV: "production", FREESWITCH_ESL_HOST: "freeswitch" },
    { NODE_ENV: "production", FREESWITCH_ESL_PASSWORD: "test-only-secret" },
    { NODE_ENV: "production", FS_ESL_HOST: "freeswitch", FS_ESL_PASSWORD: "ClueCon" },
  ])("does not silently use localhost or default production credentials", (env) => {
    expect(() => getFreeSwitchConfig(env)).toThrow("Production FreeSWITCH ESL");
  });

  it("retains explicit local-development defaults", () => {
    expect(getFreeSwitchConfig({ NODE_ENV: "development" }))
      .toEqual({ host: "127.0.0.1", port: 8021, password: "ClueCon" });
  });
});
