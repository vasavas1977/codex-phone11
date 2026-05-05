import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { fullRouter } from "../routers";
import { createContext } from "./context";
import { freeswitchRouter } from "../pbx/freeswitch-routes";
import { kamailioRouter } from "../pbx/kamailio-routes";
import { storageRouter } from "../pbx/recording-storage";
import { wsManager } from "../pbx/websocket";
import { fsEventListener } from "../pbx/fs-event-listener";

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

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Enable CORS for all routes - reflect the request origin to support credentials
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization",
    );
    res.header("Access-Control-Allow-Credentials", "true");

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerStorageProxy(app);
  registerOAuthRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
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

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  // Initialize WebSocket server for real-time events
  wsManager.init(server);

  // WebSocket status endpoint
  app.get("/api/ws/status", (_req, res) => {
    res.json({
      ok: true,
      clients: wsManager.getClientCount(),
      timestamp: Date.now(),
    });
  });

  server.listen(port, () => {
    console.log(`[api] server listening on port ${port}`);

    // Start FreeSWITCH ESL event listener after server is up
    try {
      fsEventListener.start();
    } catch (e: any) {
      console.warn(`[ESL] Failed to start event listener: ${e.message}`);
    }
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    console.log("[api] SIGTERM received, shutting down...");
    fsEventListener.stop();
    wsManager.shutdown();
    server.close();
  });
}

startServer().catch(console.error);
