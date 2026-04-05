import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { InsightsData } from "@/types/api";

export function useInsights(params: { dateFrom?: string; dateTo?: string }) {
  const searchParams = new URLSearchParams();
  if (params.dateFrom) searchParams.set("dateFrom", params.dateFrom);
  if (params.dateTo) searchParams.set("dateTo", params.dateTo);

  return useQuery({
    queryKey: ["insights", params],
    queryFn: () => apiFetch<InsightsData>(`/api/insights?${searchParams}`),
    staleTime: 2 * 60 * 1000,
  });
}
