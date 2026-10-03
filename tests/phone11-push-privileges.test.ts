import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

describe("Phone11 push database privilege boundary", () => {
  it("does not row-lock legacy read-only authority tables", async () => {
    const sources = await Promise.all([
      readFile(resolve(root, "server/push/repository.ts"), "utf8"),
      readFile(resolve(root, "server/push/wake-repository.ts"), "utf8"),
    ]);
    const lockingClauses = sources.flatMap(source =>
      [...source.matchAll(/FOR SHARE OF ([a-z, ]+)/gi)].map(match => match[1].split(",").map(alias => alias.trim())),
    );

    // PostgreSQL requires UPDATE on a table named by SELECT ... FOR SHARE.
    // Assignment, tenant, SIP and auth-identity tables are intentionally
    // read-only to the API role. Locks may only cover service-owned rows plus
    // the auth-session row used to serialize logout with registration/wake.
    const allowedAliases = new Set(["b", "p", "auths"]);
    expect(lockingClauses.flat().filter(alias => !allowedAliases.has(alias))).toEqual([]);
  });
});
