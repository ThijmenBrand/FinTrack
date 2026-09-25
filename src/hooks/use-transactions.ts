import {
  useQuery,
  useMutation,
  useIsMutating,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Transaction, Pagination, Category, PotRangeTotal, SubCategoryOption } from "@/types/api";

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
  potTotals?: PotRangeTotal[];
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

/** Hand-enter one income/expense row — money no bank export will report. */
export function useCreateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      accountId: string;
      date: string;
      description: string;
      amount: number;
      type: "income" | "expense";
      categoryId: string | null;
      notes: string | null;
    }) =>
      apiFetch<Transaction>("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
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

/** The far leg an undo rewrote: another account, now plain uncategorized income/expense. */
export type UndoneCounterpart = {
  id: string;
  amount: number;
  accountId: string;
  accountName: string | null;
  description: string;
};

/** Undo one wrong transfer pairing — both legs go back to income/expense. */
export function useUndoTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ success: boolean; reverted: number; counterparts: UndoneCounterpart[] }>(
        `/api/transactions/detect-transfers?id=${id}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
    },
  });
}

type CategorizePayload = {
  transactionId: string;
  categoryId: string | null;
  /** Sub-line under `categoryId`; the server clears it whenever the category changes. */
  subLineId?: string | null;
  createRule?: boolean;
  rulePattern?: string;
  ruleMatchType?: string;
  ruleMatchField?: string;
};

type TransactionsQueryKey = readonly [string, TransactionFilters];

/** Tags every in-flight categorisation so a row can find its own. */
const CATEGORIZE_KEY = ["transactions", "categorize"] as const;

/**
 * True while this transaction's category change is still with the server.
 * The optimistic update already shows the new category, so a row uses this to
 * say "not settled yet" rather than to hide anything.
 */
export function useIsCategorizing(transactionId: string) {
  return (
    useIsMutating({
      mutationKey: CATEGORIZE_KEY,
      predicate: (m) =>
        (m.state.variables as CategorizePayload | undefined)?.transactionId ===
        transactionId,
    }) > 0
  );
}

export function useCategorizeTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: CATEGORIZE_KEY,
    mutationFn: (payload: CategorizePayload) =>
      apiFetch("/api/transactions/categorize", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onMutate: async (payload) => {
      await qc.cancelQueries({ queryKey: ["transactions"] });

      const previous = qc.getQueriesData<TransactionsResponse>({ queryKey: ["transactions"] });

      const categories = qc.getQueryData<Category[]>(["categories"]) ?? [];
      const target = payload.categoryId
        ? categories.find((c) => c.id === payload.categoryId) ?? null
        : null;
      // The name behind the chosen sub-line, from whichever account's list the
      // picker was filled from — so the row reads right before the refetch.
      const subLineName = payload.subLineId
        ? qc
            .getQueriesData<SubCategoryOption[]>({ queryKey: ["budgets", "sub-categories"] })
            .flatMap(([, list]) => list ?? [])
            .find((line) => line.id === payload.subLineId)?.name ?? null
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
              subLineId: payload.subLineId ?? null,
              subLineName,
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
    // One request for the whole selection — DELETE /api/transactions takes a
    // comma-separated id list and runs the linked-transfer cascade set-based.
    mutationFn: (ids: string[]) =>
      apiFetch(`/api/transactions?id=${ids.map(encodeURIComponent).join(",")}`, {
        method: "DELETE",
      }),
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

export interface SplitPartInput {
  amount: number;
  categoryId?: string | null;
  description?: string | null;
  notes?: string | null;
}

/** Create (POST) or replace (PUT) a transaction's splits. */
export function useSplitTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      transactionId,
      splits,
      isEdit,
    }: {
      transactionId: string;
      splits: SplitPartInput[];
      isEdit: boolean;
    }) =>
      apiFetch<{ success: boolean; childIds: string[] }>(
        `/api/transactions/${transactionId}/split`,
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ splits }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
    },
  });
}

/** Delete a transaction's splits and restore it to a normal, uncategorized row. */
export function useUnsplitTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (transactionId: string) =>
      apiFetch(`/api/transactions/${transactionId}/split`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
    },
  });
}

export interface SplitRuleLineInput {
  categoryId: string;
  percentage?: number;
  amount?: number;
  isRemainder?: boolean;
  sortOrder: number;
}

/** Create a split rule (the "split future transactions like this" follow-up). */
export function useCreateSplitRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      pattern: string;
      matchType: string;
      matchField: string;
      mode: "percentage" | "fixed";
      lines: SplitRuleLineInput[];
      applyToExisting?: boolean;
    }) =>
      apiFetch<{ success: boolean; ruleId: string; applied: number }>("/api/split-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["split-rules"] });
      // A rule only reshapes existing rows when applied retroactively.
      if (vars.applyToExisting) qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}
