import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Transaction, Pagination, Category } from "@/types/api";

interface TransactionFilters {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
  search?: string;
  accountId?: string;
  groupId?: string;
  categoryIds?: string[];
  excludeCategoryIds?: string[];
  excludeTypes?: string[];
  types?: string[];
  dateFrom?: string;
  dateTo?: string;
  uncategorized?: boolean;
}

interface TransactionsResponse {
  data: Transaction[];
  pagination: Pagination;
  distinctTypes?: string[];
  totals?: { income: number; expense: number; transfers: number; reimbursements: number; net: number };
}

export function useTransactions(filters: TransactionFilters) {
  const params = new URLSearchParams();
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.sortBy) params.set("sortBy", filters.sortBy);
  if (filters.sortOrder) params.set("sortOrder", filters.sortOrder);
  if (filters.search) params.set("search", filters.search);
  if (filters.accountId) params.set("accountId", filters.accountId);
  if (filters.groupId) params.set("groupId", filters.groupId);
  filters.categoryIds?.forEach((id) => params.append("categoryId", id));
  filters.excludeCategoryIds?.forEach((id) => params.append("excludeCategory", id));
  filters.excludeTypes?.forEach((t) => params.append("excludeType", t));
  filters.types?.forEach((t) => params.append("type", t));
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.uncategorized) params.set("uncategorized", "true");

  return useQuery({
    queryKey: ["transactions", filters],
    queryFn: () => apiFetch<TransactionsResponse>(`/api/transactions?${params}`),
    staleTime: 15 * 1000,
    // Keep the current page's rows on screen while the next page loads instead
    // of collapsing to a skeleton on every page/filter change.
    placeholderData: keepPreviousData,
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/api/transactions?id=${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
    },
  });
}

export function useDetectTransfers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ success: boolean; matchedPairs: number; totalTransactionsUpdated: number }>("/api/transactions/detect-transfers", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["transactions"] }); },
  });
}

type CategorizePayload = {
  transactionId: string;
  categoryId: string | null;
  createRule?: boolean;
  rulePattern?: string;
  ruleMatchType?: string;
};

type TransactionsQueryKey = readonly [string, TransactionFilters];

export function useCategorizeTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CategorizePayload) =>
      apiFetch("/api/transactions/categorize", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onMutate: async (payload) => {
      await qc.cancelQueries({ queryKey: ["transactions"] });

      const previous = qc.getQueriesData<TransactionsResponse>({ queryKey: ["transactions"] });

      const categories = qc.getQueryData<Category[]>(["categories"]) ?? [];
      const target = payload.categoryId
        ? categories.find((c) => c.id === payload.categoryId) ?? null
        : null;

      for (const [key, data] of previous) {
        if (!data) continue;
        const filters = (key as TransactionsQueryKey)[1] ?? {};
        const isUncategorizedList = filters.uncategorized === true;

        if (isUncategorizedList && payload.categoryId) {
          const filtered = data.data.filter((tx) => tx.id !== payload.transactionId);
          if (filtered.length === data.data.length) continue;
          qc.setQueryData<TransactionsResponse>(key, {
            ...data,
            data: filtered,
            pagination: {
              ...data.pagination,
              total: Math.max(0, data.pagination.total - 1),
              totalPages: Math.max(
                1,
                Math.ceil(Math.max(0, data.pagination.total - 1) / data.pagination.limit)
              ),
            },
          });
        } else {
          let changed = false;
          const next = data.data.map((tx) => {
            if (tx.id !== payload.transactionId) return tx;
            changed = true;
            return {
              ...tx,
              categoryId: payload.categoryId,
              categoryName: target?.name ?? null,
              categoryColor: target?.color ?? null,
              categoryIcon: target?.icon ?? null,
            };
          });
          if (changed) qc.setQueryData<TransactionsResponse>(key, { ...data, data: next });
        }
      }

      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx?.previous) return;
      for (const [key, data] of ctx.previous) {
        qc.setQueryData(key, data);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
    },
  });
}

export function useUpdateTransactionNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { transactionId: string; notes: string | null }) =>
      apiFetch("/api/transactions/notes", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

export function useBulkCategorizeTransactions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { transactionIds: string[]; categoryId: string | null }) =>
      apiFetch("/api/transactions/categorize", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
    },
  });
}

export function useBulkDeleteTransactions() {
  const qc = useQueryClient();
  return useMutation({
    // ponytail: sequential single deletes reuse the linked-transfer cascade
    // logic in DELETE /api/transactions; add a bulk endpoint if this gets slow
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        await apiFetch(`/api/transactions?id=${id}`, { method: "DELETE" });
      }
    },
    // onSettled so already-deleted rows leave the cache even when a later delete fails
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
    },
  });
}

export function useLinkRecurringTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      transactionId: string;
      recurringTransactionId: string | null;
    }) =>
      apiFetch("/api/transactions/recurring", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
    },
  });
}

export function useReimburseTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { transactionId: string; expenseIds: string[] }) =>
      apiFetch("/api/transactions/reimburse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
    },
  });
}

export function useDeleteReimbursement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/api/transactions/reimburse?id=${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
    },
  });
}
