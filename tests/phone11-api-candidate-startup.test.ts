import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";

import { afterEach, describe, expect, it } from "vitest";

const children: ReturnType<typeof spawn>[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
});

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("missing address"));
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

async function getHealth(port: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      return await new Promise((resolve, reject) => {
        const call = request({ hostname: "127.0.0.1", port, path: "/api/health", timeout: 500 }, response => {
          const chunks: Buffer[] = [];
          response.on("data", chunk => chunks.push(chunk));
          response.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
        });
        call.once("error", reject);
        call.end();
      });
    } catch {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  throw new Error("candidate fixture did not start");
}

describe("api-candidate process startup", () => {
  it("opens the exact candidate listener without starting or stopping any background worker", async () => {
    const directory = mkdtempSync(join(tmpdir(), "phone11-candidate-startup-"));
    const marker = join(directory, "workers.log");
    const port = await freePort();
    const child = spawn(
      process.execPath,
      [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), "tests/fixtures/phone11-api-candidate-startup.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PHONE11_RUNTIME_ROLE: "api-candidate",
          PHONE11_BUILD_SHA: "startup-test-build",
          PHONE11_TEST_WORKER_MARKER: marker,
          PORT: String(port),
        },
        stdio: "ignore",
      },
    );
    children.push(child);
    try {
      await expect(getHealth(port)).resolves.toMatchObject({
        ok: true,
        build: "startup-test-build",
        service: "phone11-backend",
        runtimeRole: "api-candidate",
      });
      expect(existsSync(marker)).toBe(false);
      child.kill("SIGTERM");
      await new Promise<void>((resolve, reject) => {
        child.once("exit", code => code === 0 ? resolve() : reject(new Error(`fixture exited ${code}`)));
        child.once("error", reject);
      });
      expect(existsSync(marker) ? readFileSync(marker, "utf8") : "").toBe("");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
