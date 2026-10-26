/** Explicit isolated candidate entrypoint. No dotenv, worker or migration startup. */
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPolicyManagementApp } from "../pbx/policy-management-http";
import { closeFraudPolicyPool, getFraudPolicyBindingStatus, withFraudPolicyTransaction } from "../pbx/fraud-policy-db";

export function readPolicyManagementStartup(env: NodeJS.ProcessEnv) {
  const port = Number(env.PHONE11_POLICY_PORT), tenantId = Number(env.PHONE11_FRAUD_TENANT_ID);
  if (env.NODE_ENV !== "production" || env.PHONE11_RUNTIME_ROLE !== "api-policy" ||
    !/^[1-9][0-9]{3,4}$/.test(env.PHONE11_POLICY_PORT || "") || port < 1024 || port > 65535 ||
    !/^[1-9][0-9]*$/.test(env.PHONE11_FRAUD_TENANT_ID || "") || !Number.isSafeInteger(tenantId) || tenantId <= 0 || tenantId > 2147483647 ||
    !/^[A-Za-z0-9._-]{1,80}$/.test(env.PHONE11_BUILD_SHA || "") ||
    !["127.0.0.1", "0.0.0.0"].includes(env.PHONE11_POLICY_LISTEN_HOST || "")) {
    throw new Error("POLICY_MANAGEMENT_STARTUP_REFUSED");
  }
  return { port, tenantId, host: env.PHONE11_POLICY_LISTEN_HOST!, build: env.PHONE11_BUILD_SHA! };
}

export async function startPolicyManagementServer() {
  const config = readPolicyManagementStartup(process.env);
  if (!getFraudPolicyBindingStatus(config.tenantId).available) throw new Error("POLICY_MANAGEMENT_BINDING_REFUSED");
  try {
    // Attest the exact existing restricted role before opening the management port.
    // No policy row is written and no administrator identity is invented.
    await withFraudPolicyTransaction(config.tenantId, async () => undefined);
    const server = createServer({ maxHeaderSize: 8192 }, createPolicyManagementApp(config.build));
    server.headersTimeout = 5000;
    server.requestTimeout = 10000;
    server.keepAliveTimeout = 1000;
    server.maxConnections = 16;
    // This bounds HTTP transport only. Dedicated DB timeouts and drained shutdown
    // remain independent; a disconnected client is not proof of transaction abort.
    server.setTimeout(15000, socket => socket.destroy());
    server.on("clientError", (_error, socket) => socket.destroy());
    await new Promise<void>((accept, reject) => {
      server.once("error", reject);
      server.listen(config.port, config.host, () => { server.removeListener("error", reject); accept(); });
    });
    let stopping: Promise<void> | undefined;
    return {
      server,
      stop: () => stopping ??= (async () => {
        await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
        await closeFraudPolicyPool();
      })(),
    };
  } catch {
    // This process owns the dedicated pool. A failed listen must drain the
    // preflight lease/pool instead of retaining credentials in an idle process.
    await closeFraudPolicyPool();
    throw new Error("POLICY_MANAGEMENT_STARTUP_REFUSED");
  }
}

async function main() {
  if (process.argv.length === 2) { process.stdout.write('{"state":"UNBOUND"}\n'); return; }
  if (process.argv.length !== 3 || process.argv[2] !== "--serve-policy-management-v1") { process.exitCode = 64; return; }
  const timer = setTimeout(() => { process.stderr.write("POLICY_MANAGEMENT_STARTUP_TIMEOUT\n"); process.exit(70); }, 15000);
  let runtime: Awaited<ReturnType<typeof startPolicyManagementServer>>;
  try { runtime = await startPolicyManagementServer(); }
  catch { process.stderr.write("POLICY_MANAGEMENT_STARTUP_REFUSED\n"); process.exit(70); }
  finally { clearTimeout(timer); }
  process.stdout.write('{"state":"BOUND","runtimeRole":"api-policy","productionAcceptance":false}\n');
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    setTimeout(() => { process.stderr.write("POLICY_MANAGEMENT_DRAIN_TIMEOUT\n"); process.exit(70); }, 20000);
    void runtime.stop().then(() => process.exit(0), () => { process.stderr.write("POLICY_MANAGEMENT_DRAIN_REFUSED\n"); process.exit(70); });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(() => { process.stderr.write("POLICY_MANAGEMENT_REFUSED\n"); process.exitCode = 70; });
}
