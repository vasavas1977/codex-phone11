import { startRecordingCaptureService } from "../cloud-recordings/capture-service";
import "dotenv/config";
import { chatMediaRouter, startChatMediaRetention } from "../chat/media";
import { startChatNotificationDispatcher } from "../chat-notifications/dispatcher";
import { startRecordingAnalysisWorker, startRecordingRetentionWorker } from "../cloud-recordings/worker";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerAuthRoutes, phone11Cors } from "./auth-routes";
import { registerStorageProxy } from "./storageProxy";
import { fullRouter } from "../routers";
import { createContext } from "./context";
import { freeswitchRouter, freeswitchCdrRouter } from "../pbx/freeswitch-routes";
import { kamailioRouter } from "../pbx/kamailio-routes";
import { storageRouter } from "../pbx/recording-storage";
import { wsManager } from "../pbx/websocket";
import { fsEventListener } from "../pbx/fs-event-listener";
import { registerWakeRoutes } from "../push/wake-routes";
import {
  createPhone11RuntimeLifecycle,
  createPhone11Shutdown,
  parsePhone11RuntimePort,
  Phone11ShutdownTimeoutError,
  selectPhone11RuntimePort,
} from "./runtime-role";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

export async function startServer() {
  const runtime = createPhone11RuntimeLifecycle(
    process.env.PHONE11_RUNTIME_ROLE,
    {
      startChatNotificationDispatcher,
      startChatMediaRetention,
      startRecordingAnalysis: startRecordingAnalysisWorker,
      startRecordingRetention: startRecordingRetentionWorker,
      startRecordingCapture: startRecordingCaptureService,
      startFreeSwitchEventListener: () => {
        try {
          fsEventListener.start();
        } catch (error: any) {
          console.warn(
            `[ESL] Failed to start event listener: ${error.message}`,
          );
        }
      },
      stopFreeSwitchEventListener: () => fsEventListener.stop(),
      shutdownWebSockets: () => wsManager.shutdown(),
    },
  );
  const app = express();
  const server = createServer(app);

  const trustedProxies = process.env.PHONE11_TRUSTED_PROXY_CIDRS?.split(",").map(v => v.trim()).filter(Boolean);
  if (trustedProxies?.length) app.set("trust proxy", trustedProxies);
  app.use(phone11Cors);
  registerAuthRoutes(app);
  // Wake requests have their own small body limit and fail closed until commissioned.
  registerWakeRoutes(app);

  app.use("/api/chat/media", chatMediaRouter);
  app.use("/api/freeswitch/cdr", freeswitchCdrRouter);
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerStorageProxy(app);

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      timestamp: Date.now(),
      build: process.env.PHONE11_BUILD_SHA || "unknown",
      service: "phone11-backend",
      runtimeRole: runtime.plan.role,
    });
  });

  // FreeSWITCH REST callbacks (mod_xml_curl)
  app.use("/api/freeswitch", freeswitchRouter);

  // Kamailio REST callbacks (http_client)
  app.use("/api/kamailio", kamailioRouter);

  // Recording & voicemail storage
  app.use("/api/recordings", storageRouter);

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: fullRouter,
      createContext,
    }),
  );

  const preferredPort = parsePhone11RuntimePort(runtime.plan, process.env.PORT);
  const port = await selectPhone11RuntimePort(
    runtime.plan,
    preferredPort,
    findAvailablePort,
  );

  if (!runtime.plan.bindsPortExactly && port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  // The legacy /ws endpoint trusted caller-supplied tenant/role values.
  // Keep it disabled until upgrades use authenticated tenant membership.

  // WebSocket status endpoint
  app.get("/api/ws/status", (_req, res) => {
    res.status(503).json({
      ok: false,
      enabled: false,
      reason: "Authenticated event delivery is not enabled",
      timestamp: Date.now(),
    });
  });

  server.listen(port, () => {
    console.log(`[api] server listening on port ${port}`);
    runtime.background.start();
  });

  const shutdown = createPhone11Shutdown(server, runtime.background);
  let signalHandled = false;
  const handleSignal = (signal: "SIGTERM" | "SIGINT") => {
    if (signalHandled) return;
    signalHandled = true;
    console.log(`[api] ${signal} received, draining...`);
    void shutdown().then(
      () => {
        console.log("[api] Graceful shutdown complete");
        process.exit(0);
      },
      error => {
        if (error instanceof Phone11ShutdownTimeoutError) {
          console.error(`[api] ${error.message}`);
        } else {
          // Shutdown errors can wrap provider failures. Keep the process result
          // honest without writing raw provider, database, or credential data.
          console.error("[api] Graceful shutdown failed");
        }
        process.exit(1);
      },
    );
  };
  process.once("SIGTERM", () => handleSignal("SIGTERM"));
  process.once("SIGINT", () => handleSignal("SIGINT"));
}

startServer().catch(console.error);
