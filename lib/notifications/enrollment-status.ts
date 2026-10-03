import { create } from "zustand";
import type { ChatNotificationEnableResult } from "./coordinator";

export type ChatNotificationEnrollmentStatus =
  | "unsupported"
  | "checking"
  | "permission-required"
  | "enabling"
  | "enabled"
  | "unavailable";

type EnrollmentState = {
  ownerId: number | null;
  tenantId: number | null;
  status: ChatNotificationEnrollmentStatus;
};

export const useChatNotificationEnrollment = create<EnrollmentState>(() => ({
  ownerId: null,
  tenantId: null,
  status: "unsupported",
}));

let enableAction: (() => Promise<ChatNotificationEnableResult>) | null = null;

export function publishChatNotificationEnrollment(next: EnrollmentState): void {
  useChatNotificationEnrollment.setState(next);
}

export function installChatNotificationEnableAction(
  action: (() => Promise<ChatNotificationEnableResult>) | null,
): void {
  enableAction = action;
}

export async function requestChatNotificationEnrollment(): Promise<ChatNotificationEnableResult> {
  if (!enableAction) return { status: "unavailable" };
  return enableAction();
}

export function enrollmentStatusForResult(
  result: ChatNotificationEnableResult,
): ChatNotificationEnrollmentStatus {
  if (result.status === "enabled") return "enabled";
  if (result.status === "permission-denied") return "permission-required";
  if (result.status === "session-changed") return "checking";
  return "unavailable";
}
