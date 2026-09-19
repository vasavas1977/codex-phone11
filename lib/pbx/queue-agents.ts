export type QueueAgentDraft = {
  extensionId: number;
  priority: number;
  skills: string[];
  maxNoAnswer: number;
  isLoggedIn: boolean;
};

export function normalizeQueueAgent(value: any): QueueAgentDraft {
  return {
    extensionId: Number(value.extensionId ?? value.extension_id),
    priority: Number(value.priority),
    skills: Array.isArray(value.skills) ? value.skills.filter((skill: unknown): skill is string => typeof skill === "string") : [],
    maxNoAnswer: Number(value.maxNoAnswer ?? value.max_no_answer ?? 3),
    isLoggedIn: value.isLoggedIn ?? value.is_logged_in ?? false,
  };
}

export function validateQueueAgents(
  agents: readonly QueueAgentDraft[],
): string | null {
  const seen = new Set<number>();
  for (const agent of agents) {
    if (!Number.isSafeInteger(agent.extensionId) || agent.extensionId < 1) {
      return "Choose a valid workspace extension for every agent.";
    }
    if (seen.has(agent.extensionId)) {
      return "An extension can appear only once in a queue.";
    }
    seen.add(agent.extensionId);
    if (!Number.isSafeInteger(agent.priority) || agent.priority < 1 || agent.priority > 10000) {
      return "Priority must be a whole number from 1 to 10,000.";
    }
    if (!Number.isSafeInteger(agent.maxNoAnswer) || agent.maxNoAnswer < 0 || agent.maxNoAnswer > 100) {
      return "Max no-answer attempts must be a whole number from 0 to 100.";
    }
    if (!Array.isArray(agent.skills) || agent.skills.length > 20 || agent.skills.some((skill) => typeof skill !== "string" || !skill.trim() || skill.trim().length > 40)) {
      return "Each agent may have up to 20 non-empty skills of 40 characters or less.";
    }
  }
  return null;
}
