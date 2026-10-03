import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production backend passes only an optional server-side plain-video mapping", async () => {
  const compose = await readFile(new URL("../infra/compose/docker-compose.prod.yml", import.meta.url), "utf8");
  const marker = "PHONE11_CONNECT11_PLAIN_VIDEO_TENANTS: ${PHONE11_CONNECT11_PLAIN_VIDEO_TENANTS:-}";

  assert.equal((compose.match(/^\s+PHONE11_CONNECT11_PLAIN_VIDEO_TENANTS:/gm) ?? []).length, 1);
  assert.ok(compose.includes(marker));
  assert.ok(!compose.includes("PHONE11_CONNECT11_PLAIN_VIDEO_TENANTS: {"));
});
