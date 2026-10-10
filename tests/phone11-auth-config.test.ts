import { describe, expect, it } from "vitest";
import { readAuthConfig, sessionHeaders } from "../server/_core/phone11-auth";

const valid = { NODE_ENV: "production", PHONE11_AUTH_SECRET: "test-only-random-secret-at-least-32-characters" };
describe("Phone11 authentication configuration", () => {
  it("does not use legacy JWT secrets or Manus IDs", () => {
    expect(() => readAuthConfig({ JWT_SECRET: valid.PHONE11_AUTH_SECRET, VITE_APP_ID: "legacy" })).toThrow();
    expect(readAuthConfig(valid).baseURL).toBe("https://api.phone11.ai");
  });
  it.each(["http://api.phone11.ai", "https://user:password@api.phone11.ai", "https://api.phone11.ai/path"])(
    "rejects unsafe API origin %s", (baseURL) => {
      expect(() => readAuthConfig({ ...valid, PHONE11_AUTH_BASE_URL: baseURL })).toThrow();
    },
  );
  it.each(["https://*.phone11.ai", "https://phone11.ai/", "null", "http://localhost:8081"])(
    "rejects invalid production browser origin %s", (origin) => {
      expect(() => readAuthConfig({ ...valid, PHONE11_AUTH_TRUSTED_ORIGINS: origin })).toThrow();
    },
  );
  it("allows explicit loopback only in development", () => {
    expect(readAuthConfig({ ...valid, NODE_ENV: "test", PHONE11_AUTH_BASE_URL: "http://127.0.0.1:3001" }).baseURL)
      .toBe("http://127.0.0.1:3001");
  });
  it("never falls back to a cookie when a bearer token was supplied", () => {
    expect(sessionHeaders({ authorization: "Bearer invalid", cookie: "another-user-session" }).has("cookie")).toBe(false);
  });
});
