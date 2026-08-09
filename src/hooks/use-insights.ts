import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type {
  BalanceTimelineData,
  InsightsData,
  MoneyFlowData,
} from "@/types/api";

export function useInsights(params: {
  dateFrom?: string;
  dateTo?: string;
  accountId?: string;
  /** Scope to a budget plan's accounts (overrides accountId server-side). */
  budgetId?: string;
  /** Preceding period of equal length; when set, the API returns `previous` totals for deltas. */
  prevDateFrom?: string;
  prevDateTo?: string;
}) {
  const searchParams = new URLSearchParams();
  if (params.dateFrom) searchParams.set("dateFrom", params.dateFrom);
  if (params.dateTo) searchParams.set("dateTo", params.dateTo);
  if (params.accountId) searchParams.set("accountId", params.accountId);
  if (params.budgetId) searchParams.set("budgetId", params.budgetId);
  if (params.prevDateFrom) searchParams.set("prevDateFrom", params.prevDateFrom);
  if (params.prevDateTo) searchParams.set("prevDateTo", params.prevDateTo);

  return useQuery({
    queryKey: ["insights", params],
    queryFn: () => apiFetch<InsightsData>(`/api/insights?${searchParams}`),
    staleTime: 2 * 60 * 1000,
  });
}

export function useMoneyFlow(params: {
  dateFrom?: string;
  dateTo?: string;
  accountId?: string;
  /** The diagram is collapsed by default; don't pay for it until it's opened. */
  enabled?: boolean;
}) {
  const { enabled = true, ...query } = params;
  const searchParams = new URLSearchParams();
  if (query.dateFrom) searchParams.set("dateFrom", query.dateFrom);
  if (query.dateTo) searchParams.set("dateTo", query.dateTo);
  if (query.accountId) searchParams.set("accountId", query.accountId);

  return useQuery({
    queryKey: ["insights-flow", query],
    queryFn: () => apiFetch<MoneyFlowData>(`/api/insights/flow?${searchParams}`),
    staleTime: 2 * 60 * 1000,
    enabled,
  });
}

export function useBalanceTimeline(params: {
  accountId?: string;
  dateFrom?: string;
  dateTo?: string;
  enabled?: boolean;
}) {
  const searchParams = new URLSearchParams();
  if (params.accountId) searchParams.set("accountId", params.accountId);
  if (params.dateFrom) searchParams.set("dateFrom", params.dateFrom);
  if (params.dateTo) searchParams.set("dateTo", params.dateTo);

  return useQuery({
    queryKey: ["insights-balance", params],
    queryFn: () =>
      apiFetch<BalanceTimelineData>(`/api/insights/balance?${searchParams}`),
    staleTime: 2 * 60 * 1000,
    enabled: params.enabled ?? true,
  });
}
