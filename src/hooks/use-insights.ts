import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { BalanceTimelineData, InsightsData } from "@/types/api";

export function useInsights(params: {
  dateFrom?: string;
  dateTo?: string;
  accountId?: string;
}) {
  const searchParams = new URLSearchParams();
  if (params.dateFrom) searchParams.set("dateFrom", params.dateFrom);
  if (params.dateTo) searchParams.set("dateTo", params.dateTo);
  if (params.accountId) searchParams.set("accountId", params.accountId);

  return useQuery({
    queryKey: ["insights", params],
    queryFn: () => apiFetch<InsightsData>(`/api/insights?${searchParams}`),
    staleTime: 2 * 60 * 1000,
  });
}

export function useBalanceTimeline(params: {
  accountId?: string;
  dateFrom?: string;
  dateTo?: string;
  forecastMonths?: number;
}) {
  const searchParams = new URLSearchParams();
  if (params.accountId) searchParams.set("accountId", params.accountId);
  if (params.dateFrom) searchParams.set("dateFrom", params.dateFrom);
  if (params.dateTo) searchParams.set("dateTo", params.dateTo);
  if (params.forecastMonths)
    searchParams.set("forecastMonths", String(params.forecastMonths));

  return useQuery({
    queryKey: ["insights-balance", params],
    queryFn: () =>
      apiFetch<BalanceTimelineData>(`/api/insights/balance?${searchParams}`),
    staleTime: 2 * 60 * 1000,
  });
}
