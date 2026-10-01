import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { RecurringTx, RecurringDetail, ForecastData } from "@/types/api";

/**
 * Logos are looked up server-side after the list is sent, so while any plan is
 * still waiting on one the list re-reads itself until the answer is in.
 */
const LOGO_POLL_MS = 2500;

export function useRecurring() {
  return useQuery({
    queryKey: ["recurring"],
    queryFn: () => apiFetch<RecurringTx[]>("/api/recurring"),
    refetchInterval: (query) =>
      query.state.data?.some((p) => p.logoPending) ? LOGO_POLL_MS : false,
  });
}

export function useRecurringDetail(id: string) {
  return useQuery({
    queryKey: ["recurring", id, "detail"],
    queryFn: () => apiFetch<RecurringDetail>(`/api/recurring/${id}`),
    refetchInterval: (query) => (query.state.data?.plan.logoPending ? LOGO_POLL_MS : false),
  });
}

export function useRecurringForecast(months = 3) {
  return useQuery({
    queryKey: ["recurring-forecast", months],
    queryFn: () => apiFetch<ForecastData>(`/api/recurring/forecast?months=${months}`),
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Everything a plan write can move. Resolves once the plan list itself has
 * refetched — the one the update and delete spinners wait on.
 */
function invalidatePlanViews(qc: QueryClient): Promise<void> {
  qc.invalidateQueries({ queryKey: ["recurring-forecast"] });
  // Fixed costs and monthly income on the budgets page are derived entirely
  // from these rows, so they go stale with every edit.
  qc.invalidateQueries({ queryKey: ["budgets"] });
  // A new plan or rule links matching history; a deleted plan unlinks its rows.
  qc.invalidateQueries({ queryKey: ["transactions"] });
  qc.invalidateQueries({ queryKey: ["dashboard"] });
  return qc.invalidateQueries({ queryKey: ["recurring"] });
}

/** Take back a rule a first link taught a plan, and the rows it linked. */
export function useUndoLearnedRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, pattern, linkedIds }: { planId: string; pattern: string; linkedIds: string[] }) =>
      apiFetch(`/api/recurring/${encodeURIComponent(planId)}/undo-learned-rule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern, transactionIds: linkedIds }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["insights"] });
      return invalidatePlanViews(qc);
    },
  });
}

export function useCreateRecurring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch("/api/recurring", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => {
      invalidatePlanViews(qc);
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
      await invalidatePlanViews(qc);
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
      await invalidatePlanViews(qc);
    },
  });
}

/**
 * Where a logo is drawn: the plan list and detail, and the upcoming-payments
 * strip (the forecast). Nothing derived from amounts moves.
 */
function invalidateLogoViews(qc: QueryClient): Promise<void> {
  qc.invalidateQueries({ queryKey: ["recurring-forecast"] });
  return qc.invalidateQueries({ queryKey: ["recurring"] });
}

/**
 * Find a plan's logo — from `source` (a website, image link or company name),
 * or from the plan's own name when it's left out.
 */
export function useSetRecurringLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, source }: { id: string; source?: string }) =>
      apiFetch<{ logoUrl: string; logoSource: string }>(`/api/recurring/${encodeURIComponent(id)}/logo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(source ? { source } : {}),
      }),
    onSuccess: () => invalidateLogoViews(qc),
  });
}

export function useRemoveRecurringLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/recurring/${encodeURIComponent(id)}/logo`, { method: "DELETE" }),
    onSuccess: () => invalidateLogoViews(qc),
  });
}
