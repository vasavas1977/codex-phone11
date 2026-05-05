/**
 * DID Provisioning Hooks — CloudPhone11
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { didClient, type DIDConfig, type DIDNumberType } from "./client";

// ─── Search available DID numbers ────────────────────────────────────────────

export function useAvailableDIDs(params: {
  countryCode?: string;
  type?: DIDNumberType;
  city?: string;
  limit?: number;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ["did", "available", params.countryCode, params.type, params.city],
    queryFn: () => didClient.searchAvailable(params),
    staleTime: 5 * 60_000,
    retry: 2,
    enabled: params.enabled !== false,
  });
}

// ─── My active DIDs ──────────────────────────────────────────────────────────

export function useMyDIDs() {
  return useQuery({
    queryKey: ["did", "my"],
    queryFn: () => didClient.getMyDIDs(),
    staleTime: 60_000,
    retry: 2,
  });
}

// ─── Purchase a DID ──────────────────────────────────────────────────────────

export function usePurchaseDID() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ didId, forwardTo, assignedTo }: {
      didId: string;
      forwardTo?: string;
      assignedTo?: string;
    }) => didClient.purchaseDID(didId, { forwardTo, assignedTo }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["did", "my"] });
    },
  });
}

// ─── Cancel a DID ────────────────────────────────────────────────────────────

export function useCancelDID() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (didId: string) => didClient.cancelDID(didId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["did", "my"] });
    },
  });
}

// ─── Update DID forwarding ───────────────────────────────────────────────────

export function useUpdateDIDForwarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ didId, forwardTo }: { didId: string; forwardTo: string }) =>
      didClient.updateForwarding(didId, forwardTo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["did", "my"] });
    },
  });
}

// ─── Save DID config ─────────────────────────────────────────────────────────

export function useSaveDIDConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: Partial<DIDConfig>) => didClient.saveConfig(config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["did"] });
    },
  });
}
