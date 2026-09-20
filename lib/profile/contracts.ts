export const manualAvailabilityOptions = [
  { value: "available", label: "Available" },
  { value: "away", label: "Away" },
  { value: "busy", label: "Busy" },
  { value: "out_of_office", label: "Out of office" },
  { value: "dnd", label: "Do not disturb" },
] as const;

export type ManualAvailability = (typeof manualAvailabilityOptions)[number]["value"];
export type WorkLocation = "office" | "remote";
export type DndDurationMinutes = 20 | 60 | 240 | 480 | 1440;
export type StatusExpiryPreset = "1h" | "4h" | "today" | "week" | "always";

export type WorkspaceProfileStatus = {
  userId: number;
  manualAvailability: ManualAvailability | null;
  manualAvailabilityExpiresAt: Date | null;
  statusText: string | null;
  statusExpiresAt: Date | null;
  workLocation: WorkLocation | null;
};

export type WorkspaceProfileUpdate = {
  availability?: { value: ManualAvailability | null; expiresInMinutes?: DndDurationMinutes };
  status?: { text: string | null; expiry?: StatusExpiryPreset };
  workLocation?: WorkLocation | null;
};

export const dndExpiryOptions: ReadonlyArray<{ value: DndDurationMinutes; label: string }> = [
  { value: 20, label: "20 min" },
  { value: 60, label: "1 hr" },
  { value: 240, label: "4 hrs" },
  { value: 480, label: "8 hrs" },
  { value: 1440, label: "24 hrs" },
];

export const statusExpiryOptions: ReadonlyArray<{ value: StatusExpiryPreset; label: string }> = [
  { value: "1h", label: "1 hr" },
  { value: "4h", label: "4 hrs" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "always", label: "Always" },
];
