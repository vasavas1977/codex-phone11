import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

import {
  createPhone11RuntimeLifecycle,
  parsePhone11RuntimePort,
} from "../../server/_core/runtime-role";

const marker = process.env.PHONE11_TEST_WORKER_MARKER;
if (!marker) throw new Error("PHONE11_TEST_WORKER_MARKER is required");
const markerPath = marker;

function worker(name: string): void {
  appendFileSync(markerPath, `${name}\n`);
}

const runtime = createPhone11RuntimeLifecycle(process.env.PHONE11_RUNTIME_ROLE, {
  startChatNotificationDispatcher: () => worker("chat-notification"),
  startChatMediaRetention: () => {
    worker("chat-media-retention");
    return () => worker("chat-media-retention-stop");
  },
  startRecordingAnalysis: () => {
    worker("recording-analysis");
    return () => worker("recording-analysis-stop");
  },
  startRecordingRetention: () => {
    worker("recording-retention");
    return () => worker("recording-retention-stop");
  },
  startRecordingCapture: () => {
    worker("recording-capture");
    return () => worker("recording-capture-stop");
  },
  startFreeSwitchEventListener: () => worker("esl"),
  stopFreeSwitchEventListener: () => worker("esl-stop"),
  shutdownWebSockets: () => worker("websocket-stop"),
});
const port = parsePhone11RuntimePort(runtime.plan, process.env.PORT);
const server = createServer((request, response) => {
  if (request.url !== "/api/health") {
    response.writeHead(404).end();
    return;
  }
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({
    ok: true,
    build: process.env.PHONE11_BUILD_SHA,
    service: "phone11-backend",
    runtimeRole: runtime.plan.role,
  }));
});

server.listen(port, "127.0.0.1", () => runtime.background.start());
process.on("SIGTERM", () => server.close(() => process.exit(0)));
