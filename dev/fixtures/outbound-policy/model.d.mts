export type GeneratedUser = { id: number; name: string };
export type Observation = { ownerId: number; authIdentity: number; tenantId: number; admissionScope: string;
  configured: boolean; internationalEnabled: boolean; premiumRateEnabled: boolean };
export type FixtureState = { user: GeneratedUser; account: string; authIdentity: number; tenantId: number;
  scopeKey: string; supported: boolean; revoked: boolean; mutationPending: boolean;
  query: { data: Observation | undefined; isLoading: boolean; isFetching: boolean; isError: boolean; isSuccess: boolean };
  nextReadFails: boolean; nextSaveFails: boolean; nextSaveSlow: boolean; nextReadbackMismatch: boolean; event: string };
export function createFixtureModel(wait?: (ms: number) => Promise<unknown>): {
  snapshot(): FixtureState;
  subscribe(listener: () => void): () => void;
  subscribeAuth(listener: () => void): () => void;
  load(): Promise<{ isError: boolean; data: Observation | undefined }>;
  mutate(input: { tenantId: number; internationalEnabled: boolean; premiumRateEnabled: boolean }): Promise<{ success: boolean }>;
  chooseTenant(id: number): void; chooseAccount(account: string): void; reauthenticate(): void;
  setRevoked(value: boolean): void; setSupported(value: boolean): void; arm(name: string): void;
};
