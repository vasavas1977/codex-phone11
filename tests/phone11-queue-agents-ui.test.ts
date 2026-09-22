import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeQueueAgent,
  validateQueueAgents,
  type QueueAgentDraft,
} from "../lib/pbx/queue-agents";

const source = readFileSync(
  resolve(process.cwd(), "app/admin/queues.tsx"),
  "utf8",
);

const agent = (overrides: Partial<QueueAgentDraft> = {}): QueueAgentDraft => ({
  extensionId: 10,
  priority: 1,
  skills: ["sales"],
  maxNoAnswer: 3,
  isLoggedIn: false,
  ...overrides,
});

describe("queue agent editor", () => {
  it("normalizes database bigint fields and preserves stored metadata", () => {
    expect(normalizeQueueAgent({
      extension_id: "10",
      priority: "2",
      skills: ["sales", 3],
      max_no_answer: "6",
      is_logged_in: true,
    })).toEqual({
      extensionId: 10,
      priority: 2,
      skills: ["sales"],
      maxNoAnswer: 6,
      isLoggedIn: true,
    });
  });

  it("rejects duplicates and unsafe bounded values before mutation", () => {
    expect(validateQueueAgents([agent()])).toBeNull();
    expect(validateQueueAgents([agent(), agent({ priority: 2 })])).toContain("only once");
    expect(validateQueueAgents([agent({ extensionId: 0 })])).toContain("valid workspace extension");
    expect(validateQueueAgents([agent({ priority: 10001 })])).toContain("Priority");
    expect(validateQueueAgents([agent({ maxNoAnswer: 101 })])).toContain("Max no-answer");
    expect(validateQueueAgents([agent({ skills: Array.from({ length: 21 }, (_, i) => String(i)) })])).toContain("20");
  });

  it("wires a locked, retryable editor with active extension choices only", () => {
    expect(source).toContain("useCallQueue");
    expect(source).toContain("useUpdateCallQueue");
    expect(source).toContain("useSetQueueAgents");
    expect(source).toMatch(/useExtensions\(\s*1,\s*100,\s*queuesAvailable\s*&&\s*\(editingQueueId !== null \|\| editingSettingsId !== null\)\s*&&\s*tenantId > 0,\s*\)/);
    expect(source).toContain('accessibilityLabel={`Edit agents for ${item.name}`}');
    expect(source).toContain('accessibilityLabel={"Add extension " + String(extension.extension_number)}');
    expect(source).toContain("agentsMutation.isPending");
    expect(source).toContain("queueDetailQuery.refetch()");
    expect(source).toContain("closeAgents(true)");
    expect(source).toContain("Your changes are still here; try again.");
    expect(source).toContain("priority: agent.priority");
    expect(source).toContain("skills: agent.skills");
    expect(source).toContain("max_no_answer: agent.maxNoAnswer");
    expect(source).toContain("isLoggedIn: true");
    expect(source).toContain("Enabled for calls");
    expect(source).toContain("legacy settings unsupported");
    expect(source).toContain('strategy: "ring_all"');
    expect(source).toContain("Queue settings");
    expect(source).toContain("Overflow route");
    expect(source).toContain("menu.is_active === true");
    expect(source).not.toContain("Distribution Strategy");
    expect(source).not.toContain("Priority for agent");
    expect(source).not.toContain("Max Callers");
    expect(source).not.toContain(">Stats</Text>");
    expect(source).not.toContain("skills for agent");
    expect(source).not.toContain("Max no-answer");
  });
});
