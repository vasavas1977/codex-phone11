/**
 * Call Analytics Store (Zustand)
 *
 * Manages analytics dashboard state including time range selection,
 * dashboard data, and loading/error states.
 */

import { create } from "zustand";
import type { AnalyticsDashboard, AnalyticsTimeRange } from "./types";
import { analyticsEngine } from "./engine";

interface AnalyticsState {
  dashboard: AnalyticsDashboard | null;
  timeRange: AnalyticsTimeRange;
  isLoading: boolean;
  error: string | null;

  setTimeRange: (range: AnalyticsTimeRange) => void;
  fetchDashboard: (range?: AnalyticsTimeRange) => Promise<void>;
  refresh: () => Promise<void>;
}

export const useAnalyticsStore = create<AnalyticsState>((set, get) => ({
  dashboard: null,
  timeRange: "7d",
  isLoading: false,
  error: null,

  setTimeRange: (range) => {
    set({ timeRange: range });
    get().fetchDashboard(range);
  },

  fetchDashboard: async (range) => {
    const timeRange = range || get().timeRange;
    set({ isLoading: true, error: null });
    try {
      const dashboard = await analyticsEngine.computeDashboard(timeRange);
      set({ dashboard, isLoading: false });
    } catch (err: any) {
      console.error("[AnalyticsStore] Failed to fetch dashboard:", err);
      set({ error: err.message || "Failed to load analytics", isLoading: false });
    }
  },

  refresh: async () => {
    await get().fetchDashboard();
  },
}));
