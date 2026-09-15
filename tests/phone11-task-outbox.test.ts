import { describe, expect, it } from "vitest";
import {
  Phone11TaskOutbox,
  type TaskQueueStorage,
} from "../lib/tasks/durable-outbox";

type Command = {
  operationId: string;
  taskId: string;
  owner: string;
  text: string;
};
function fixture() {
  const data = new Map<string, string>();
  let active = true;
  let fail = false;
  const storage: TaskQueueStorage = {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      if (fail) throw Error("disk full");
      data.set(key, value);
    },
  };
  const make = (accountKey = "server:alice") =>
    new Phone11TaskOutbox<Command>({
      storage,
      accountKey,
      isCurrentSession: () => active,
      validate: (v): v is Command =>
        !!v &&
        typeof v === "object" &&
        typeof (v as Command).operationId === "string" &&
        typeof (v as Command).taskId === "string" &&
        (v as Command).owner === accountKey &&
        typeof (v as Command).text === "string",
    });
  return {
    data,
    make,
    deactivate: () => {
      active = false;
    },
    fail: () => {
      fail = true;
    },
  };
}
const command = (operationId = "op1", taskId = "task1"): Command => ({
  operationId,
  taskId,
  owner: "server:alice",
  text: "Private follow-up",
});
const accepted = async (c: Command) => ({
  kind: "accepted" as const,
  operationId: c.operationId,
  taskId: c.taskId,
});

describe("Phone11 durable task queue", () => {
  it("persists across restart and acknowledges only the matching operation", async () => {
    const f = fixture();
    await f.make().enqueue(command());
    const queue = f.make();
    await queue.flush(async (c) => ({
      ...(await accepted(c)),
      operationId: "wrong",
    }));
    expect(await queue.pending()).toHaveLength(1);
    await queue.flush(accepted);
    expect(await f.make().pending()).toEqual([]);
  });
  it("deduplicates retries and rejects changed intent under the same ID", async () => {
    const q = fixture().make();
    await q.enqueue(command());
    expect(await q.enqueue(command())).toBe("duplicate");
    await expect(q.enqueue({ ...command(), text: "Changed" })).rejects.toThrow(
      "reused",
    );
  });
  it("retains offline and conflicting edits while another task progresses", async () => {
    const q = fixture().make();
    await q.enqueue(command());
    await q.enqueue(command("op2"));
    await q.enqueue(command("op3", "task2"));
    const sent: string[] = [];
    await q.flush(async (c) => {
      sent.push(c.operationId);
      return c.taskId === "task1" ? { kind: "conflict" } : accepted(c);
    });
    expect(sent).toEqual(["op1", "op3"]);
    expect((await q.pending()).map((c) => c.operationId)).toEqual([
      "op1",
      "op2",
    ]);
    await q.flush(async () => {
      throw Error("offline");
    });
    expect(await q.pending()).toHaveLength(2);
  });
  it("does not acknowledge an in-flight result after account change", async () => {
    const f = fixture();
    const q = f.make();
    await q.enqueue(command());
    await expect(
      q.flush(async (c) => {
        f.deactivate();
        return accepted(c);
      }),
    ).rejects.toThrow("session changed");
    expect([...f.data.values()][0]).toContain("op1");
  });
  it("isolates accounts and rejects cross-account commands", async () => {
    const f = fixture();
    await f.make().enqueue(command());
    const bob = f.make("server:bob");
    expect(await bob.pending()).toEqual([]);
    await expect(bob.enqueue(command())).rejects.toThrow("Invalid");
  });
  it("retains the operation when acknowledgement cannot be stored", async () => {
    const f = fixture();
    const q = f.make();
    await q.enqueue(command());
    f.fail();
    await expect(q.flush(accepted)).rejects.toThrow("disk full");
    expect(await q.pending()).toHaveLength(1);
  });
  it("preserves corrupt storage and blocks sends", async () => {
    const f = fixture();
    f.data.set("@phone11:task-outbox:v1:server:alice", "broken");
    await expect(f.make().flush(accepted)).rejects.toThrow();
    expect([...f.data.values()]).toEqual(["broken"]);
  });
  it("snapshots input before concurrent writes and stops a disposed instance", async () => {
    const q = fixture().make();
    const c = command();
    const write = q.enqueue(c);
    c.text = "Changed";
    await write;
    expect((await q.pending())[0].text).toBe("Private follow-up");
    q.stop();
    await expect(q.pending()).rejects.toThrow("session changed");
  });
});
