import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { BudgetData, BudgetSuggestion, HistoryData, Transaction } from "@/types/api";
import type { EmptyGenerateReason } from "@/lib/auto-budget";
import type { ImportPayload } from "@/lib/budget-import";

export function useBudgets(opts?: {
  dateFrom?: string;
  dateTo?: string;
  accountId?: string;
  budgetId?: string;
  noScale?: boolean;
  enabled?: boolean;
  /** Yearly plans: which financial year and which month inside it. */
  year?: number;
  monthIndex?: number;
}) {
  const dateFrom = opts?.dateFrom || "";
  const dateTo = opts?.dateTo || "";
  const accountId = opts?.accountId || "";
  const budgetId = opts?.budgetId || "";
  const noScale = !!opts?.noScale;
  const year = opts?.year ?? null;
  const monthIndex = opts?.monthIndex ?? null;
  const params = new URLSearchParams();
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  if (accountId) params.set("accountId", accountId);
  if (budgetId) params.set("budgetId", budgetId);
  if (noScale) params.set("noScale", "1");
  if (year !== null) params.set("year", String(year));
  if (monthIndex !== null) params.set("monthIndex", String(monthIndex));
  const qs = params.toString();
  return useQuery({
    queryKey: [
      "budgets",
      { dateFrom, dateTo, accountId, budgetId, noScale, year, monthIndex },
    ],
    queryFn: () => apiFetch<BudgetData>(qs ? `/api/budgets?${qs}` : "/api/budgets"),
    enabled: opts?.enabled ?? true,
  });
}

/**
 * A sub-line draft in the add/edit modal, as POST /api/budgets accepts it. A
 * node with children derives its amount from them; a node with `recurring` or
 * `adoptRecurringId` derives it from that plan — both server-side, so what is
 * sent for those is ignored.
 */
export interface BudgetChildInput {
  name: string;
  amount: number;
  children?: BudgetChildInput[];
  /** Link an existing plan the user chose to adopt. */
  adoptRecurringId?: string;
  /** Or create one, in the shape POST /api/recurring validates. */
  recurring?: {
    accountId: string;
    /** Per occurrence, positive; the server applies the expense sign. */
    amount: number;
    frequency: "weekly" | "biweekly" | "monthly" | "yearly";
    dayOfWeek?: number | null;
    dayOfMonth?: number | null;
    monthOfYear?: number | null;
    startDate: string;
  };
}

export function useCreateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      categoryId: string;
      amount: number;
      budgetId?: string;
      /** Ignored for the allocation's own amount when non-empty: it becomes their sum. */
      children?: BudgetChildInput[];
    }) =>
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

export interface BudgetImportResult {
  createdCategories: number;
  /** budgets allocations created */
  created: number;
  subLinesCreated: number;
  /** recurring_transactions rows created with type="expense" */
  fixedPlansCreated: number;
  /** recurring_transactions rows created with type="income" */
  incomePlansCreated: number;
  skipped: { name: string; reason: "notBudgetable" | "tooManySubLines" | "kindConflict" | "alreadyBudgeted" }[];
}

export function useImportBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ImportPayload) =>
      apiFetch<BudgetImportResult>("/api/budgets/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
      // fixed/income roots land as recurring plans, not allocations.
      qc.invalidateQueries({ queryKey: ["recurring"] });
    },
  });
}

export function useBudgetHistory(categoryId: string | null, enabled: boolean, budgetId?: string, kind?: "income" | "expense") {
  return useQuery({
    queryKey: ["budget-history", categoryId, budgetId ?? "", kind ?? "expense"],
    queryFn: () => {
      const params = new URLSearchParams({ categoryId: categoryId ?? "" });
      if (budgetId) params.set("budgetId", budgetId);
      if (kind === "income") params.set("type", "income");
      return apiFetch<HistoryData>(`/api/budgets/history?${params}`);
    },
    enabled: !!categoryId && enabled,
    staleTime: 60 * 1000,
  });
}

export function useGenerateBudgets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload?: { budgetId?: string }) =>
      apiFetch<{
        suggestions: BudgetSuggestion[];
        emptyReason: EmptyGenerateReason | null;
      }>("/api/budgets/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {}),
      }),
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

export function useCreateSubLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { allocationId: string; parentId?: string | null; name: string; amount: number }) =>
      apiFetch("/api/budgets/sub-lines", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["budgets"] }); },
  });
}

export function useUpdateSubLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      id: string;
      name?: string;
      amount?: number;
      /** Link to an existing recurring plan, or `null` to unlink. Absent leaves the link untouched. */
      recurringId?: string | null;
    }) =>
      apiFetch("/api/budgets/sub-lines", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["budgets"] }); },
  });
}

export function useDeleteSubLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/api/budgets/sub-lines?id=${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["budgets"] }); },
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
