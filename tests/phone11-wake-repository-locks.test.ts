import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const repositoryUrl = new URL(
  "../server/push/wake-repository.ts",
  import.meta.url,
);

describe("wake repository row-lock boundaries", () => {
  it("never requests row-lock privilege on read-only identity, assignment, or SIP tables", async () => {
    const source = await readFile(repositoryUrl, "utf8");
    const explicitLockTargets = [
      ...source.matchAll(
        /\bFOR\s+(?:SHARE|UPDATE)\s+OF\s+([a-z][a-z0-9_]*(?:\s*,\s*[a-z][a-z0-9_]*)*)/gi,
      ),
    ].flatMap((match) => match[1].split(",").map((alias) => alias.trim()));

    expect(new Set(explicitLockTargets)).toEqual(new Set(["auths", "p", "b"]));
    expect(explicitLockTargets).not.toEqual(
      expect.arrayContaining(["ai", "ue", "e", "t", "sa", "sub"]),
    );
  });

  it("retains locks on writable authority rows and revalidates after the unlocked SIP credential read", async () => {
    const source = await readFile(repositoryUrl, "utf8");

    expect(source).toContain("FOR SHARE OF auths");
    expect(source).toContain("FOR SHARE OF p");
    expect(source).toContain("FOR SHARE OF b,p,auths");
    expect(source).toContain(
      "SELECT * FROM phone11_wake_bindings WHERE tenant_id=$1 AND extension_id=$2 FOR UPDATE",
    );
    expect(source).toContain(
      "SELECT id FROM phone11_wake_bindings WHERE id=$1 FOR UPDATE",
    );
    expect(source).toMatch(
      /const sipRows=[\s\S]*?FROM sip_accounts sa JOIN subscriber sub[\s\S]*?\$3`, \[b\.extension_id,b\.tenant_id,b\.sip_uri\]\);[\s\S]*?await authenticate\(client,bindingId,grant\);/,
    );
    expect(source).not.toMatch(
      /FROM sip_accounts sa JOIN subscriber sub[\s\S]*?FOR (?:SHARE|UPDATE) OF (?:sa|sub)/,
    );
  });
});
