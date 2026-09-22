export const phone11RuntimeRoles = ["default", "api-candidate"] as const;

export type Phone11RuntimeRole = (typeof phone11RuntimeRoles)[number];

export interface Phone11RuntimePlan {
  readonly role: Phone11RuntimeRole;
  readonly startsBackgroundServices: boolean;
  readonly bindsPortExactly: boolean;
}

export type StopRuntimeService = () => void | Promise<void>;

export interface Phone11BackgroundServices {
  startChatNotificationDispatcher(): StopRuntimeService;
  startChatMediaRetention(): StopRuntimeService;
  startRecordingAnalysis(): StopRuntimeService;
  startRecordingRetention(): StopRuntimeService;
  startRecordingCapture(): StopRuntimeService;
  startFreeSwitchEventListener(): void;
  stopFreeSwitchEventListener(): void | Promise<void>;
  shutdownWebSockets(): void | Promise<void>;
}

export interface Phone11BackgroundLifecycle {
  start(): void;
  stop(): Promise<void>;
}

export interface Phone11RuntimeLifecycle {
  readonly plan: Phone11RuntimePlan;
  readonly background: Phone11BackgroundLifecycle;
}

function noop(): void {}

const stoppedBackground: Phone11BackgroundLifecycle = {
  start: noop,
  stop: async () => undefined,
};

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
    return stoppedBackground;
  }

  let started = false;
  let stopPromise: Promise<void> | undefined;
  let stopChatNotificationDispatcher: StopRuntimeService = noop;
  let stopChatMediaRetention: StopRuntimeService = noop;
  let stopRecordingAnalysis: StopRuntimeService = noop;
  let stopRecordingRetention: StopRuntimeService = noop;
  let stopRecordingCapture: StopRuntimeService = noop;

  return {
    start() {
      if (started || stopPromise) return;
      started = true;
      stopChatNotificationDispatcher = services.startChatNotificationDispatcher();
      stopChatMediaRetention = services.startChatMediaRetention();
      stopRecordingAnalysis = services.startRecordingAnalysis();
      stopRecordingRetention = services.startRecordingRetention();
      stopRecordingCapture = services.startRecordingCapture();
      services.startFreeSwitchEventListener();
    },
    async stop() {
      if (stopPromise) return stopPromise;
      if (!started) return;
      started = false;
      const stops: StopRuntimeService[] = [
        stopChatNotificationDispatcher,
        stopRecordingAnalysis,
        stopRecordingRetention,
        stopRecordingCapture,
        stopChatMediaRetention,
        services.stopFreeSwitchEventListener,
        services.shutdownWebSockets,
      ];
      stopPromise = (async () => {
        const results = await Promise.allSettled(stops.map(stop => {
          try {
            return Promise.resolve(stop());
          } catch (error) {
            return Promise.reject(error);
          }
        }));
        const failures = results.filter(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        if (failures.length) {
          throw new AggregateError(
            failures.map(result => result.reason),
            "Phone11 background shutdown failed",
          );
        }
      })();
      return stopPromise;
    },
  };
}

// A plain-video join can already be admitted when shutdown starts. Its bounded
// path includes two 10s Connect11 requests and two 3s admission transactions.
// Keep enough room for that 26s path to confirm before the process exits.
export const PHONE11_SHUTDOWN_TIMEOUT_MS = 30_000;

export class Phone11ShutdownTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Phone11 graceful shutdown timed out after ${timeoutMs}ms`);
    this.name = "Phone11ShutdownTimeoutError";
  }
}

export interface Phone11HttpServerLifecycle {
  close(callback: (error?: Error) => void): void;
  closeAllConnections?(): void;
}

/**
 * Stops HTTP admission immediately. Admitted handlers finish before background
 * producers stop, so a handler cannot enqueue work after its worker drained.
 * Both phases share one deadline and one promise for repeated signals.
 */
export function createPhone11Shutdown(
  server: Phone11HttpServerLifecycle,
  background: Phone11BackgroundLifecycle,
  timeoutMs = PHONE11_SHUTDOWN_TIMEOUT_MS,
): () => Promise<void> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new Error("Invalid Phone11 shutdown timeout");
  }

  let shutdownPromise: Promise<void> | undefined;
  return () => {
    if (shutdownPromise) return shutdownPromise;

    let backgroundStopPromise: Promise<void> | undefined;
    const stopBackground = () => {
      if (backgroundStopPromise) return backgroundStopPromise;
      try {
        backgroundStopPromise = Promise.resolve(background.stop());
      } catch (error) {
        backgroundStopPromise = Promise.reject(error);
      }
      return backgroundStopPromise;
    };
    const httpClosed = new Promise<void>((resolve, reject) => {
      try {
        server.close(error => error ? reject(error) : resolve());
      } catch (error) {
        reject(error);
      }
    });
    const drained = httpClosed.then(stopBackground);
    shutdownPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // A stuck admitted request must not leave schedulers, sockets, or the
        // listener alive until the container kills them. This is best effort;
        // the timeout remains the reported shutdown result.
        void stopBackground().catch(() => undefined);
        server.closeAllConnections?.();
        reject(new Phone11ShutdownTimeoutError(timeoutMs));
      }, timeoutMs);
      drained.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        error => {
          clearTimeout(timer);
          void stopBackground().catch(() => undefined);
          server.closeAllConnections?.();
          reject(error);
        },
      );
    });
    return shutdownPromise;
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
