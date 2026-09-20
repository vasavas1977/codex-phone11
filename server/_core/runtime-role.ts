export const phone11RuntimeRoles = ["default", "api-candidate"] as const;

export type Phone11RuntimeRole = (typeof phone11RuntimeRoles)[number];

export interface Phone11RuntimePlan {
  readonly role: Phone11RuntimeRole;
  readonly startsBackgroundServices: boolean;
  readonly bindsPortExactly: boolean;
}

export type StopRuntimeService = () => void;

export interface Phone11BackgroundServices {
  startChatNotificationDispatcher(): void;
  startChatMediaRetention(): StopRuntimeService;
  startRecordingAnalysis(): StopRuntimeService;
  startRecordingRetention(): StopRuntimeService;
  startRecordingCapture(): StopRuntimeService;
  startFreeSwitchEventListener(): void;
  stopFreeSwitchEventListener(): void;
  shutdownWebSockets(): void;
}

export interface Phone11BackgroundLifecycle {
  start(): void;
  stop(): void;
}

export interface Phone11RuntimeLifecycle {
  readonly plan: Phone11RuntimePlan;
  readonly background: Phone11BackgroundLifecycle;
}

function noop(): void {}

/**
 * Parses the one process-wide Phone11 backend role. An unknown role must fail
 * before any listener or background worker can be started.
 */
export function createPhone11RuntimePlan(
  value = process.env.PHONE11_RUNTIME_ROLE,
): Phone11RuntimePlan {
  const role = value === undefined ? "default" : value;

  if (role === "default") {
    return { role, startsBackgroundServices: true, bindsPortExactly: false };
  }

  if (role === "api-candidate") {
    return { role, startsBackgroundServices: false, bindsPortExactly: true };
  }

  throw new Error(
    `Invalid PHONE11_RUNTIME_ROLE ${JSON.stringify(value)}. Expected "default" or "api-candidate".`,
  );
}

/**
 * Keeps the default role's legacy PORT parsing, while requiring a candidate to
 * name one exact, valid TCP port instead of falling back or accepting a prefix.
 */
export function parsePhone11RuntimePort(
  plan: Phone11RuntimePlan,
  value = process.env.PORT,
): number {
  if (!plan.bindsPortExactly) return parseInt(value || "3000");

  if (typeof value !== "string" || !/^[1-9][0-9]{0,4}$/.test(value)) {
    throw new Error(
      `Invalid PORT ${JSON.stringify(value)} for api-candidate. Expected a decimal integer from 1 to 65535.`,
    );
  }

  const port = Number(value);
  if (port > 65535) {
    throw new Error(
      `Invalid PORT ${JSON.stringify(value)} for api-candidate. Expected a decimal integer from 1 to 65535.`,
    );
  }
  return port;
}

/**
 * Keeps worker construction explicit so importing this module cannot start
 * timers, network listeners, or shutdown hooks.
 */
export function createPhone11BackgroundLifecycle(
  plan: Phone11RuntimePlan,
  services: Phone11BackgroundServices,
): Phone11BackgroundLifecycle {
  if (!plan.startsBackgroundServices) {
    return { start: noop, stop: noop };
  }

  let started = false;
  let stopChatMediaRetention: StopRuntimeService = noop;
  let stopRecordingAnalysis: StopRuntimeService = noop;
  let stopRecordingRetention: StopRuntimeService = noop;
  let stopRecordingCapture: StopRuntimeService = noop;

  return {
    start() {
      if (started) return;
      started = true;
      services.startChatNotificationDispatcher();
      stopChatMediaRetention = services.startChatMediaRetention();
      stopRecordingAnalysis = services.startRecordingAnalysis();
      stopRecordingRetention = services.startRecordingRetention();
      stopRecordingCapture = services.startRecordingCapture();
      services.startFreeSwitchEventListener();
    },
    stop() {
      if (!started) return;
      started = false;
      stopRecordingAnalysis();
      stopRecordingRetention();
      stopRecordingCapture();
      stopChatMediaRetention();
      services.stopFreeSwitchEventListener();
      services.shutdownWebSockets();
    },
  };
}

/**
 * Builds the role plan before exposing the lifecycle. This is deliberately
 * injectable for startup tests and makes an invalid role fail before effects.
 */
export function createPhone11RuntimeLifecycle(
  value: string | undefined,
  services: Phone11BackgroundServices,
): Phone11RuntimeLifecycle {
  const plan = createPhone11RuntimePlan(value);
  return { plan, background: createPhone11BackgroundLifecycle(plan, services) };
}

/**
 * Candidate APIs bind only the requested port. The normal role preserves the
 * legacy available-port selection used by existing development deployments.
 */
export async function selectPhone11RuntimePort(
  plan: Phone11RuntimePlan,
  preferredPort: number,
  findAvailablePort: (startPort: number) => Promise<number>,
): Promise<number> {
  return plan.bindsPortExactly
    ? preferredPort
    : findAvailablePort(preferredPort);
}
