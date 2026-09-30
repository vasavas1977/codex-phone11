export type InvitationRole = "user" | "admin";
export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";
export type InvitationDeliveryStatus = "pending" | "sent" | "failed";

/** Public administrative summary. The bearer token and its digest never appear here. */
export type InvitationSummary = {
  id: string;
  email: string;
  role: InvitationRole;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  deliveryStatus: InvitationDeliveryStatus;
  deliveryError?: string | null;
};

export type InvitationInspection = {
  workspaceName: string;
  email: string;
  role: InvitationRole;
  expiresAt: string;
  mode: "create_account" | "sign_in";
};
