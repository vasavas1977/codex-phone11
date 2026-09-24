/** Privileged main-process owner of one local Siprix helper and one session. */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename, isAbsolute } from "node:path";
import {
  DesktopCallBoundary, HelperCommandRejectedError,
  type DesktopSession, type HelperCommand, type PublicSnapshot,
} from "./call-boundary";

export type SipAccountSecret = Readonly<{
  accountId: string;
  server: string;
  extension: string;
  authId: string;
  password: string;
  transport: "TLS" | "TCP" | "UDP";
}>;

type Context = {
  child: ChildProcess;
  generation: string;
  epoch: number;
  session: DesktopSession;
  sequence: number;
  buffer: string;
  queue: Promise<void>;
  pending: { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null;
};

export type SupervisorOptions = Readonly<{
  helperPath: string;
  /** Must return the main process's current authenticated session, never renderer input. */
  currentSession: () => DesktopSession | null;
  /** Privileged provider must enforce the tenant and extension grant. */
  provision: (session: DesktopSession) => Promise<SipAccountSecret>;
  /** Must verify the canonical packaged binary and its signature/hash. */
  verifyHelper: (path: string) => Promise<boolean>;
  onSnapshot?: (snapshot: PublicSnapshot) => void;
  commandTimeoutMs?: number;
  dialCallbackTimeoutMs?: number;
  shutdownGraceMs?: number;
  /** Test seam; production uses a private stdin/stdout pipe without a shell. */
  launch?: (path: string) => ChildProcess;
}>;

const sameSession = (a: DesktopSession | null, b: DesktopSession): boolean =>
  !!a && a.revision === b.revision && a.userId === b.userId &&
  a.tenantId === b.tenantId && a.extensionId === b.extensionId && a.accountId === b.accountId;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const callId = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]{0,9}$/.test(value);
const field = (value: string, max: number): boolean =>
  value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const destination = (value: unknown): value is string =>
  typeof value === "string" && /^\+?[0-9*#]{1,32}$/.test(value);
const digits = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9*#A-D]{1,32}$/.test(value);

export class DesktopHelperSupervisor {
  private readonly boundary: DesktopCallBoundary;
  private readonly timeoutMs: number;
  private readonly launch: (path: string) => ChildProcess;
  private current: Context | null = null;
  private starting = false;
  private epoch = 0;
  private stopping: Promise<boolean> | null = null;
  private stopUnsafe = false;
  private readonly shutdownGraceMs: number;

  constructor(private readonly options: SupervisorOptions) {
    if (!isAbsolute(options.helperPath) ||
        !["phone11_siprix_helper", "phone11_siprix_helper.exe"].includes(basename(options.helperPath)) ||
        typeof options.verifyHelper !== "function" ||
        !Number.isSafeInteger(options.commandTimeoutMs ?? 10_000) || (options.commandTimeoutMs ?? 10_000) < 1 ||
        !Number.isSafeInteger(options.shutdownGraceMs ?? 500) || (options.shutdownGraceMs ?? 500) < 1)
      throw new Error("Invalid helper configuration");
    this.timeoutMs = options.commandTimeoutMs ?? 10_000;
    this.shutdownGraceMs = options.shutdownGraceMs ?? 500;
    this.launch = options.launch ?? (path => spawn(path, [], {
      stdio: ["pipe", "pipe", "ignore"], shell: false, windowsHide: true,
    }));
    this.boundary = new DesktopCallBoundary({ execute: command => this.execute(command) },
      options.dialCallbackTimeoutMs, () => this.notifySnapshot());
  }

  /** Acquires credentials only through the injected privileged provider. */
  async start(): Promise<string> {
    if (this.current || this.starting) throw new Error("Helper already active");
    this.starting = true;
    const epoch = this.epoch;
    try {
      if (this.stopping && !(await this.stopping)) throw new Error("Previous helper exit unverified");
      if (this.stopUnsafe) throw new Error("Previous helper exit unverified");
      if (epoch !== this.epoch) throw new Error("Helper start cancelled");
      if (!(await this.options.verifyHelper(this.options.helperPath)) || epoch !== this.epoch)
        throw new Error("Helper executable unverified");
      const activeSession = this.options.currentSession();
      if (!activeSession) throw new Error("Calling session unavailable");
      // Pin identity before an asynchronous credential lookup; a mutable auth
      // object must not silently retarget this helper to another extension.
      const session = Object.freeze({ ...activeSession });
      const secret = await this.options.provision(session);
      if (epoch !== this.epoch || !sameSession(this.options.currentSession(), session) ||
          secret.accountId !== session.accountId ||
          !field(secret.server, 512) || !field(secret.extension, 256) ||
          !field(secret.authId, 256) || !field(secret.password, 4096) ||
          !["TLS", "TCP", "UDP"].includes(secret.transport))
        throw new Error("Calling provisioning unavailable");
      const child = this.launch(this.options.helperPath);
      if (!child.stdin || !child.stdout) {
        child.kill();
        throw new Error("Helper pipe unavailable");
      }
      const ctx: Context = {
        child, generation: randomUUID(), epoch, session: Object.freeze({ ...session }),
        sequence: 0, buffer: "", queue: Promise.resolve(), pending: null,
      };
      this.current = ctx;
      this.boundary.startHelperGeneration(ctx.generation);
      this.boundary.bindSession(ctx.session, ctx.generation);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => this.onData(ctx, chunk));
      child.on("error", () => this.close(ctx));
      child.on("exit", () => this.close(ctx));
      await this.send(ctx, "v1 init\n");
      // Frame exists only for this write; no credential goes to argv, env,
      // logs, renderer state, or a persistent property.
      await this.send(ctx, `v1 provision\n${secret.server}\n${secret.extension}\n${secret.authId}\n${secret.password}\n${secret.transport}\n`);
      if (this.current !== ctx || epoch !== this.epoch || !sameSession(this.options.currentSession(), session)) {
        this.close(ctx);
        throw new Error("Calling session changed");
      }
      return ctx.generation;
    } catch {
      this.stop();
      throw new Error("Desktop calling could not start");
    } finally {
      this.starting = false;
    }
  }

  stop(): Promise<boolean> {
    this.epoch++;
    return this.current ? this.retire(this.current, true) : this.stopping ?? Promise.resolve(!this.stopUnsafe);
  }

  snapshot(): PublicSnapshot {
    if (this.current && !this.sessionMatches(this.current)) this.stop();
    return this.boundary.snapshot();
  }

  /** IPC caller must authenticate its sender; renderer cannot supply session. */
  async handleRendererAction(input: unknown): Promise<PublicSnapshot> {
    const ctx = this.current;
    if (!ctx || !this.sessionMatches(ctx)) {
      this.stop();
      throw new Error("Calling session changed");
    }
    let result: PublicSnapshot;
    try { result = await this.boundary.handleRendererAction(input, ctx.session); }
    catch (error) {
      if (!this.sessionMatches(ctx)) {
        this.stop();
        throw new Error("Calling session changed");
      }
      throw error;
    }
    if (this.current === ctx && !this.sessionMatches(ctx)) this.stop();
    if (this.current !== ctx) throw new Error("Calling session changed");
    return result;
  }

  private execute(command: HelperCommand): Promise<void> {
    const ctx = this.current;
    if (!ctx || command.version !== 1 || command.generation !== ctx.generation ||
        command.sessionRevision !== ctx.session.revision || command.accountId !== ctx.session.accountId ||
        !this.sessionMatches(ctx))
      return Promise.reject(new Error("Calling session changed"));
    let frame: string;
    if (command.operation === "dial" && destination(command.destination)) frame = `v1 dial ${command.destination}\n`;
    else if ((command.operation === "answer" || command.operation === "end") && callId(command.callId))
      frame = `v1 ${command.operation} ${command.callId}\n`;
    else if ((command.operation === "mute" || command.operation === "hold") && callId(command.callId) &&
             typeof command.value === "boolean") frame = `v1 ${command.operation} ${command.callId} ${command.value ? 1 : 0}\n`;
    else if (command.operation === "dtmf" && callId(command.callId) && digits(command.value))
      frame = `v1 dtmf ${command.callId} ${command.value}\n`;
    else return Promise.reject(new Error("Invalid helper command"));
    return this.send(ctx, frame);
  }

  private send(ctx: Context, frame: string): Promise<void> {
    const work = ctx.queue.then(() => this.sendNow(ctx, frame));
    ctx.queue = work.catch(() => {});
    return work;
  }

  private sendNow(ctx: Context, frame: string): Promise<void> {
    // Reauthorize at actual write time, not only when a command enters the
    // queue. This also guards provision after a slow init response.
    if (this.current !== ctx || ctx.epoch !== this.epoch ||
        !ctx.child.stdin?.writable || !this.sessionMatches(ctx)) {
      if (this.current === ctx) this.retire(ctx, false);
      return Promise.reject(new Error("Helper unavailable"));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(ctx), this.timeoutMs);
      ctx.pending = { resolve, reject, timer };
      try { ctx.child.stdin!.write(frame, error => { if (error) this.close(ctx); }); }
      catch { this.close(ctx); }
    });
  }

  private onData(ctx: Context, chunk: string): void {
    if (this.current !== ctx) return;
    ctx.buffer += chunk;
    if (Buffer.byteLength(ctx.buffer, "utf8") > 8192) { this.close(ctx); return; }
    let newline: number;
    while (this.current === ctx && (newline = ctx.buffer.indexOf("\n")) !== -1) {
      const line = ctx.buffer.slice(0, newline);
      ctx.buffer = ctx.buffer.slice(newline + 1);
      if (Buffer.byteLength(line, "utf8") > 4096) { this.close(ctx); return; }
      let input: unknown;
      try { input = JSON.parse(line); } catch { this.close(ctx); return; }
      if (!record(input) || input.version !== 1) { this.close(ctx); return; }
      if (input.event === undefined && typeof input.ok === "boolean" && typeof input.initialized === "boolean") {
        const pending = ctx.pending;
        if (!pending) { this.close(ctx); return; }
        ctx.pending = null;
        clearTimeout(pending.timer);
        if (input.ok) pending.resolve();
        else pending.reject(new HelperCommandRejectedError());
        continue;
      }
      if (!this.forwardEvent(ctx, input)) { this.close(ctx); return; }
    }
  }

  private forwardEvent(ctx: Context, raw: Record<string, unknown>): boolean {
    if (!this.sessionMatches(ctx)) return false;
    const base = { version: 1, generation: ctx.generation, sequence: ++ctx.sequence,
      sessionRevision: ctx.session.revision, accountId: ctx.session.accountId };
    let event: Record<string, unknown>;
    if (raw.event === "registration" && typeof raw.registered === "boolean")
      event = { ...base, type: "registration", registered: raw.registered };
    else if (raw.event === "call" && callId(raw.callId) && typeof raw.state === "string" &&
             ["incoming", "dialing", "ringing", "connected", "held", "terminated"].includes(raw.state) &&
             typeof raw.muted === "boolean")
      event = { ...base, type: "call", callId: raw.callId, state: raw.state, muted: raw.muted };
    else if (raw.event === "hold_error" && callId(raw.callId) && raw.code === "state_unconfirmed" && raw.holdControl === "blocked")
      event = { ...base, type: "hold_error", callId: raw.callId, code: "state_unconfirmed", holdControl: "blocked" };
    else if (raw.event === "hold_recovered" && callId(raw.callId) && raw.code === "state_confirmed" && raw.holdControl === "ready")
      event = { ...base, type: "hold_recovered", callId: raw.callId, code: "state_confirmed", holdControl: "ready" };
    else return false;
    if (this.boundary.receiveHelperEvent(event)) this.notifySnapshot();
    return true; // Valid but stale call events are safely ignored by boundary.
  }

  private sessionMatches(ctx: Context): boolean {
    try { return sameSession(this.options.currentSession(), ctx.session); }
    catch { return false; }
  }

  private notifySnapshot(): void {
    // Boundary timers can fire after the authenticated session has changed,
    // before the embedder has a chance to call stop(). Never publish the old
    // tenant's registered/call/reconcile state across that gap.
    const ctx = this.current;
    if (ctx && !this.sessionMatches(ctx)) {
      this.retire(ctx, false); // clear() emits the only permissible snapshot.
      return;
    }
    try { this.options.onSnapshot?.(this.boundary.snapshot()); }
    catch { /* A renderer notification error cannot compromise the helper. */ }
  }

  private close(ctx: Context): void {
    this.retire(ctx, false);
  }

  private retire(ctx: Context, graceful: boolean): Promise<boolean> {
    if (this.current !== ctx) return this.stopping ?? Promise.resolve(!this.stopUnsafe);
    this.current = null;
    if (ctx.pending) {
      clearTimeout(ctx.pending.timer);
      ctx.pending.reject(new Error("Helper unavailable"));
      ctx.pending = null;
    }
    this.boundary.clear();
    this.notifySnapshot();
    let resolveExit!: (exited: boolean) => void;
    const completion = new Promise<boolean>(resolve => { resolveExit = resolve; });
    this.stopping = completion;
    let finished = false;
    const child = ctx.child;
    const finish = (exited: boolean) => {
      if (finished) {
        if (exited) { this.stopUnsafe = false; if (this.stopping === completion) this.stopping = null; }
        return;
      }
      finished = true;
      clearTimeout(graceTimer);
      clearTimeout(forceTimer);
      clearTimeout(boundTimer);
      if (!exited) this.stopUnsafe = true;
      else if (this.stopping === completion) this.stopping = null;
      resolveExit(exited);
    };
    const onExit = () => finish(true);
    child.once("exit", onExit);
    const graceTimer = setTimeout(() => { try { child.kill("SIGTERM"); } catch {} },
      graceful ? this.shutdownGraceMs : 1);
    const forceTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} },
      this.shutdownGraceMs * 2);
    const boundTimer = setTimeout(() => finish(false), this.shutdownGraceMs * 3);
    if (child.exitCode !== null || child.signalCode !== null) finish(true);
    else if (graceful) {
      try { child.stdin?.end("v1 shutdown\n"); } catch { try { child.kill("SIGTERM"); } catch {} }
    } else {
      try { child.stdin?.end(); } catch {}
      try { child.kill("SIGTERM"); } catch {}
    }
    return completion;
  }
}
