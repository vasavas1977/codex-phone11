/**
 * BillRun React Hooks — CloudPhone11
 * Provides live billing data from BillRun BSS API.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { billRunClient, type BillRunConfig } from "./client";

// ─── Account Balance ─────────────────────────────────────────────────────────

export function useBillRunBalance(accountId?: string) {
  return useQuery({
    queryKey: ["billrun", "balance", accountId],
    queryFn: () => billRunClient.getAccount(accountId),
    staleTime: 60_000,         // Refresh every 60s
    retry: 2,
  });
}

// ─── Invoices ────────────────────────────────────────────────────────────────

export function useBillRunInvoices(accountId?: string, limit = 12) {
  return useQuery({
    queryKey: ["billrun", "invoices", accountId, limit],
    queryFn: () => billRunClient.getInvoices(accountId, limit),
    staleTime: 5 * 60_000,    // Refresh every 5 min
    retry: 2,
  });
}

// ─── CDR Usage Lines ─────────────────────────────────────────────────────────

export function useBillRunUsage(accountId?: string) {
  return useQuery({
    queryKey: ["billrun", "usage", accountId],
    queryFn: () => billRunClient.getUsageLines(accountId),
    staleTime: 5 * 60_000,
    retry: 2,
  });
}

// ─── Plans ───────────────────────────────────────────────────────────────────

export function useBillRunPlans() {
  return useQuery({
    queryKey: ["billrun", "plans"],
    queryFn: () => billRunClient.getPlans(),
    staleTime: 10 * 60_000,
    retry: 2,
  });
}

// ─── Config mutation ─────────────────────────────────────────────────────────

export function useSaveBillRunConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: Partial<BillRunConfig>) => billRunClient.saveConfig(config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billrun"] });
    },
  });
}

// ─── Autorenew (plan subscription) ───────────────────────────────────────────

export function useCreateAutorenew() {
  return useMutation({
    mutationFn: (params: {
      accountId: string;
      planName: string;
      quantity?: number;
      description?: string;
    }) => billRunClient.createAutorenew(params),
  });
}
