import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { BudgetData, BudgetSuggestion, HistoryData, Transaction } from "@/types/api";

export function useBudgets(opts?: {
  dateFrom?: string;
  dateTo?: string;
  noScale?: boolean;
}) {
  const dateFrom = opts?.dateFrom || "";
  const dateTo = opts?.dateTo || "";
  const noScale = !!opts?.noScale;
  const params = new URLSearchParams();
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  if (noScale) params.set("noScale", "1");
  const qs = params.toString();
  return useQuery({
    queryKey: ["budgets", { dateFrom, dateTo, noScale }],
    queryFn: () => apiFetch<BudgetData>(qs ? `/api/budgets?${qs}` : "/api/budgets"),
  });
}

export function useCreateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { categoryId: string; amount: number }) =>
      apiFetch("/api/budgets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["budgets"] }); },
  });
}

export function useUpdateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { id: string; amount: number }) =>
      apiFetch("/api/budgets", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["budgets"] }); },
  });
}

export function useDeleteBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/api/budgets?id=${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["budgets"] }); },
  });
}

export function useBudgetHistory(categoryId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["budget-history", categoryId],
    queryFn: () => apiFetch<HistoryData>(`/api/budgets/history?categoryId=${categoryId}`),
    enabled: !!categoryId && enabled,
    staleTime: 60 * 1000,
  });
}

export function useGenerateBudgets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ suggestions: BudgetSuggestion[] }>("/api/budgets/generate", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}

export function useAcceptBudgetSuggestions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: { id: string; amount?: number }[]) =>
      apiFetch<{ success: boolean; count: number }>("/api/budgets/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", items }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}

export function useRejectBudgetSuggestions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<{ success: boolean; count: number }>("/api/budgets/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", ids }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}

export function useBudgetMonthTransactions(categoryId: string, dateFrom: string, dateTo: string, enabled: boolean) {
  return useQuery({
    queryKey: ["transactions", { categoryId, dateFrom, dateTo, type: "expense" }],
    queryFn: () => apiFetch<{ data: Transaction[] }>(`/api/transactions?categoryId=${categoryId}&dateFrom=${dateFrom}&dateTo=${dateTo}&type=expense&limit=100&sortBy=date&sortOrder=desc`),
    enabled,
    staleTime: 60 * 1000,
  });
}
