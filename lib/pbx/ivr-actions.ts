export const IVR_ACTION_TYPES = [
  { value: "transfer_ext", label: "Extension" },
  { value: "transfer_queue", label: "Queue" },
  { value: "transfer_ringgroup", label: "Ring group" },
  { value: "sub_menu", label: "Another menu" },
  { value: "voicemail", label: "Voicemail" },
  { value: "hangup", label: "End call" },
  { value: "repeat", label: "Repeat greeting" },
  { value: "dial_by_name", label: "Dial by name" },
] as const;

export type SupportedActionType = (typeof IVR_ACTION_TYPES)[number]["value"];

export type IvrActionDraft = {
  id?: number;
  digit: string;
  action_type: string;
  target?: string;
  description?: string;
  sort_order: number;
};

export const TARGET_ACTIONS = new Set<string>([
  "transfer_ext",
  "transfer_queue",
  "transfer_ringgroup",
  "sub_menu",
  "voicemail",
]);

export function validateIvrActionDraft(actions: readonly IvrActionDraft[]): string | null {
  const seen = new Set<string>();
  for (const action of actions) {
    if (!/^[0-9*#]{1,5}$/.test(action.digit)) {
      return "Each key must contain 1 to 5 DTMF digits (0-9, * or #).";
    }
    if (seen.has(action.digit)) return `The key ${action.digit} is used more than once.`;
    seen.add(action.digit);
    if (!IVR_ACTION_TYPES.some((item) => item.value === action.action_type)) {
      return `${action.action_type} is not supported by this Phone11 build. Remove it before saving.`;
    }
    const hasTarget = Boolean(action.target?.trim());
    if (TARGET_ACTIONS.has(action.action_type) !== hasTarget) {
      return TARGET_ACTIONS.has(action.action_type)
        ? `Choose a destination for ${action.action_type}.`
        : `${action.action_type} does not use a destination.`;
    }
  }
  return null;
}
