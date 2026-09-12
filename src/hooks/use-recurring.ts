import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { RecurringTx, ForecastData } from "@/types/api";

export function useRecurring() {
  return useQuery({
    queryKey: ["recurring"],
    queryFn: () => apiFetch<RecurringTx[]>("/api/recurring"),
  });
}

export function useRecurringForecast(months = 3) {
  return useQuery({
    queryKey: ["recurring-forecast", months],
    queryFn: () => apiFetch<ForecastData>(`/api/recurring/forecast?months=${months}`),
    staleTime: 2 * 60 * 1000,
  });
}

export function useCreateRecurring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch("/api/recurring", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring"] });
      qc.invalidateQueries({ queryKey: ["recurring-forecast"] });
      // Fixed costs and monthly income on the budgets page are derived
      // entirely from these rows, so they go stale with every edit.
      qc.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}

export function useUpdateRecurring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch("/api/recurring", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    // Awaited for the same reason as the delete below: a pause that stops
    // spinning before the row re-reads still shows the old state.
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["recurring"] });
      qc.invalidateQueries({ queryKey: ["recurring-forecast"] });
      // Fixed costs and monthly income on the budgets page are derived
      // entirely from these rows, so they go stale with every edit.
      qc.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}

export function useDeleteRecurring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/api/recurring?id=${id}`, { method: "DELETE" }),
    // Awaited, so isPending stays true until the list has actually refetched —
    // otherwise the spinner stops while the deleted row is still on screen.
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["recurring"] });
      qc.invalidateQueries({ queryKey: ["recurring-forecast"] });
      // Fixed costs and monthly income on the budgets page are derived
      // entirely from these rows, so they go stale with every edit.
      qc.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}
