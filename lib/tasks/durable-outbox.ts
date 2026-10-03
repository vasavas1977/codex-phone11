/** Device-side persistence only. The shared adapter owns command validation and
 * server authorization. Construct one instance per storage key in the app. */
export interface TaskQueueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface TaskQueueCommand {
  operationId: string;
  taskId: string;
}

export type TaskQueueReply =
  | { kind: "accepted"; operationId: string; taskId: string }
  | { kind: "conflict" }
  | { kind: "retry" };

interface QueueState<C> {
  version: 1;
  commands: C[];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export class Phone11TaskOutbox<C extends TaskQueueCommand> {
  private serial: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private readonly key: string;

  constructor(
    private readonly options: {
      storage: TaskQueueStorage;
      /** Include installation/server account namespace, not merely a numeric user ID. */
      accountKey: string;
      isCurrentSession: () => boolean;
      /** Must validate the entire shared command and its explicit account scope. */
      validate: (value: unknown) => value is C;
    },
  ) {
    if (!/^[A-Za-z0-9._:-]{1,200}$/.test(options.accountKey))
      throw new Error("Invalid task account");
    this.key = `@phone11:task-outbox:v1:${options.accountKey}`;
  }

  stop() {
    this.stopped = true;
  }

  private assertSession() {
    if (this.stopped || !this.options.isCurrentSession())
      throw new Error("Task session changed");
  }

  private ordered<T>(work: () => Promise<T>): Promise<T> {
    const result = this.serial.then(work);
    this.serial = result.catch(() => undefined);
    return result;
  }

  private async read(): Promise<QueueState<C>> {
    this.assertSession();
    const raw = await this.options.storage.getItem(this.key);
    this.assertSession();
    if (raw === null) return { version: 1, commands: [] };
    const state = JSON.parse(raw) as QueueState<C>;
    if (
      !state ||
      state.version !== 1 ||
      !Array.isArray(state.commands) ||
      !state.commands.every(this.options.validate) ||
      new Set(state.commands.map((c) => c.operationId)).size !==
        state.commands.length
    ) {
      throw new Error("Task queue needs recovery");
    }
    return state;
  }

  private async write(state: QueueState<C>) {
    this.assertSession();
    await this.options.storage.setItem(this.key, JSON.stringify(state));
    this.assertSession();
  }

  /** Caller invokes only after explicit Save to Tasks; never scan/import recordings. */
  enqueue(command: C): Promise<"queued" | "duplicate"> {
    // Freeze the intent before any await; callers cannot mutate a pending write.
    const snapshot: unknown = JSON.parse(JSON.stringify(command));
    return this.ordered(async () => {
      if (!this.options.validate(snapshot))
        throw new Error("Invalid task command");
      const state = await this.read();
      const prior = state.commands.find(
        (c) => c.operationId === snapshot.operationId,
      );
      if (prior) {
        if (canonical(prior) !== canonical(snapshot))
          throw new Error("Task operation ID reused");
        return "duplicate";
      }
      await this.write({ version: 1, commands: [...state.commands, snapshot] });
      return "queued";
    });
  }

  pending(): Promise<readonly C[]> {
    return this.ordered(async () => (await this.read()).commands);
  }

  /** Transport is supplied by the separate authenticated Phone11 adapter.
   * Conflicts retain the original intent and block subsequent edits of that task.
   * No automatic version rebasing or private-to-workspace conversion occurs here. */
  flush(send: (command: C) => Promise<TaskQueueReply>): Promise<void> {
    return this.ordered(async () => {
      let state = await this.read();
      const blocked = new Set<string>();
      for (const command of [...state.commands]) {
        this.assertSession();
        if (blocked.has(command.taskId)) continue;
        let reply: TaskQueueReply;
        try {
          reply = await send(JSON.parse(JSON.stringify(command)) as C);
        } catch {
          blocked.add(command.taskId);
          continue;
        }
        this.assertSession();
        if (
          reply.kind !== "accepted" ||
          reply.operationId !== command.operationId ||
          reply.taskId !== command.taskId
        ) {
          blocked.add(command.taskId);
          continue;
        }
        const next = {
          version: 1 as const,
          commands: state.commands.filter(
            (c) => c.operationId !== command.operationId,
          ),
        };
        // On persistence failure the same operation remains durable for retry.
        await this.write(next);
        state = next;
      }
    });
  }
}
