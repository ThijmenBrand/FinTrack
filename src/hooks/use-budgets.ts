import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type {
  BudgetData,
  BudgetSubLine,
  BudgetSuggestion,
  CategoryWithDetails,
  HistoryData,
  Transaction,
} from "@/types/api";
import {
  addLine,
  hasLine,
  patchBudget,
  removeLine,
  updateLine,
  upsertAllocation,
  withSubLines,
} from "@/lib/budget-cache";
import type { EmptyGenerateReason } from "@/lib/auto-budget";
import type { ImportPayload } from "@/lib/budget-import";

/**
 * Every budgets write on the page is optimistic: the page reads one query for
 * the whole plan, and waiting on a round-trip before the row moved made
 * changing an allocation feel like the page had stopped responding. `onMutate`
 * writes what the endpoint would have written, `onError` puts the payloads
 * back, and `onSettled` refetches so the server has the last word either way.
 */
type Snapshot = [QueryKey, BudgetData | undefined][];

/**
 * Patch every cached payload the budgets page reads, returning what was there
 * before so a failure can put it back.
 *
 * Only the unscaled copies: a ranged query (the insights page) multiplies
 * every amount by the length of its range, and a monthly figure written into
 * one of those would read as a different budget. `budgetId` narrows further
 * for a write that is only true of one plan — a new row belongs to the plan it
 * was created in, while an edit or a delete finds its own row by id anyway.
 */
function patchCaches(
  qc: QueryClient,
  change: (data: BudgetData) => BudgetData,
  budgetId?: string,
): Snapshot {
  const previous = qc.getQueriesData<BudgetData>({ queryKey: ["budgets"] });
  for (const [key, data] of previous) {
    const scope = (key as [string, { noScale?: boolean; budgetId?: string }])[1];
    if (!data || !scope?.noScale) continue;
    if (budgetId !== undefined && scope.budgetId !== budgetId) continue;
    qc.setQueryData(key, change(data));
  }
  return previous;
}

/** Everything the optimistic writes have in common, so each one says only what it does. */
function optimistic(qc: QueryClient) {
  return {
    begin: async () => {
      // In-flight refetches would land on top of the patch below.
      await qc.cancelQueries({ queryKey: ["budgets"] });
    },
    /** Nothing was patched when the snapshot is empty, so this is a no-op then. */
    onError: (_err: unknown, _vars: unknown, previous: Snapshot | undefined) => {
      for (const [key, data] of previous ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["budgets"] });
    },
  };
}

/** The category behind a new allocation, for the row shown before the refetch. */
function cachedCategory(qc: QueryClient, categoryId: string) {
  for (const [, list] of qc.getQueriesData<CategoryWithDetails[]>({
    queryKey: ["categories"],
  })) {
    const found = list?.find((c) => c.id === categoryId);
    if (found) return found;
  }
  return undefined;
}

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
  const shared = optimistic(qc);
  return useMutation({
    mutationFn: (payload: {
      categoryId: string;
      amount: number;
      budgetId?: string;
      /** Ignored for the allocation's own amount when non-empty: it becomes their sum. */
      children?: BudgetChildInput[];
    }) =>
      apiFetch("/api/budgets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onMutate: async (payload) => {
      // A submitted tree carries amounts the server derives (a linked plan's
      // monthly figure, a container's sum) and ids it mints, so that path
      // waits for the response — the dialog holds a spinner over it.
      if (payload.children?.length) return [];
      await shared.begin();
      const category = cachedCategory(qc, payload.categoryId);
      return patchCaches(
        qc,
        (data) =>
          patchBudget(
            {
              ...data,
              // The category stops being unbudgeted the moment it has a line.
              unbudgetedSpending: data.unbudgetedSpending.filter(
                (u) => u.categoryId !== payload.categoryId,
              ),
            },
            (allocations) =>
              upsertAllocation(allocations, {
                categoryId: payload.categoryId,
                categoryName: category?.name ?? null,
                categoryColor: category?.color ?? null,
                amount: payload.amount,
                // What the category has already spent this month: until now it
                // was counted as unbudgeted, which is where that figure is.
                spent:
                  data.unbudgetedSpending.find(
                    (u) => u.categoryId === payload.categoryId,
                  )?.spent ?? 0,
              }),
          ),
        payload.budgetId ?? "",
      );
    },
    onError: shared.onError,
    onSettled: shared.onSettled,
  });
}

export function useUpdateBudget() {
  const qc = useQueryClient();
  const shared = optimistic(qc);
  return useMutation({
    mutationFn: (payload: { id: string; amount: number }) =>
      apiFetch("/api/budgets", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onMutate: async ({ id, amount }) => {
      await shared.begin();
      return patchCaches(qc, (data) =>
        patchBudget(data, (allocations) =>
          allocations.map((a) => (a.id === id ? { ...a, amount, pending: true } : a)),
        ),
      );
    },
    onError: shared.onError,
    onSettled: shared.onSettled,
  });
}

export function useDeleteBudget() {
  const qc = useQueryClient();
  const shared = optimistic(qc);
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/api/budgets?id=${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await shared.begin();
      return patchCaches(qc, (data) =>
        patchBudget(data, (allocations) => allocations.filter((a) => a.id !== id)),
      );
    },
    onError: shared.onError,
    onSettled: shared.onSettled,
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
  const shared = optimistic(qc);
  return useMutation({
    mutationFn: (items: { id: string; amount?: number }[]) =>
      apiFetch<{ success: boolean; count: number }>("/api/budgets/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", items }),
      }),
    onMutate: async (items) => {
      await shared.begin();
      const amounts = new Map(items.map((i) => [i.id, i.amount]));
      // Suggestions belong to one plan, so a payload holding none of these
      // ids is another plan's and comes back unchanged.
      return patchCaches(qc, (data) => {
        const accepted = data.suggestions.filter((s) => amounts.has(s.id));
        if (accepted.length === 0) return data;
        const takenCategories = new Set(accepted.map((s) => s.categoryId));
        return patchBudget(
          {
            ...data,
            suggestions: data.suggestions.filter((s) => !amounts.has(s.id)),
            // Those categories stop being unbudgeted the moment they have a line.
            unbudgetedSpending: data.unbudgetedSpending.filter(
              (u) => !takenCategories.has(u.categoryId),
            ),
          },
          (allocations) =>
            accepted.reduce(
              (list, s) =>
                upsertAllocation(list, {
                  categoryId: s.categoryId,
                  categoryName: s.categoryName,
                  categoryColor: s.categoryColor,
                  amount: amounts.get(s.id) ?? s.suggestedAmount,
                  spent:
                    list.find((a) => a.categoryId === s.categoryId)?.spent ??
                    data.unbudgetedSpending.find(
                      (u) => u.categoryId === s.categoryId,
                    )?.spent ??
                    0,
                }),
              allocations,
            ),
        );
      });
    },
    onError: shared.onError,
    onSettled: shared.onSettled,
  });
}

export function useRejectBudgetSuggestions() {
  const qc = useQueryClient();
  const shared = optimistic(qc);
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<{ success: boolean; count: number }>("/api/budgets/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", ids }),
      }),
    onMutate: async (ids) => {
      await shared.begin();
      return patchCaches(qc, (data) => ({
        ...data,
        suggestions: data.suggestions.filter((s) => !ids.includes(s.id)),
      }));
    },
    onError: shared.onError,
    onSettled: shared.onSettled,
  });
}

export function useCreateSubLine() {
  const qc = useQueryClient();
  const shared = optimistic(qc);
  return useMutation({
    mutationFn: (payload: { allocationId: string; parentId?: string | null; name: string; amount: number }) =>
      apiFetch("/api/budgets/sub-lines", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onMutate: async ({ allocationId, parentId, name, amount }) => {
      await shared.begin();
      const line: BudgetSubLine = {
        id: `pending:${crypto.randomUUID()}`,
        parentId: parentId ?? null,
        name,
        amount,
        children: [],
        pending: true,
      };
      return patchCaches(qc, (data) =>
        patchBudget(data, (allocations) =>
          allocations.map((a) =>
            a.id === allocationId
              ? withSubLines(a, addLine(a.subLines, parentId ?? null, line))
              : a,
          ),
        ),
      );
    },
    onError: shared.onError,
    onSettled: shared.onSettled,
  });
}

export function useUpdateSubLine() {
  const qc = useQueryClient();
  const shared = optimistic(qc);
  return useMutation({
    mutationFn: (payload: {
      id: string;
      name?: string;
      amount?: number;
      /** Link to an existing recurring plan, or `null` to unlink. Absent leaves the link untouched. */
      recurringId?: string | null;
    }) =>
      apiFetch("/api/budgets/sub-lines", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onMutate: async ({ id, name, amount, recurringId }) => {
      // Linking a plan re-derives the line's amount from that plan's cadence
      // server-side; nothing here can work that out, so it waits.
      if (recurringId !== undefined) return [];
      await shared.begin();
      const patch = {
        ...(name !== undefined ? { name } : {}),
        ...(amount !== undefined ? { amount } : {}),
        pending: true,
      };
      return patchCaches(qc, (data) =>
        patchBudget(data, (allocations) =>
          allocations.map((a) =>
            hasLine(a.subLines, id)
              ? withSubLines(a, updateLine(a.subLines, id, patch))
              : a,
          ),
        ),
      );
    },
    onError: shared.onError,
    onSettled: shared.onSettled,
  });
}

export function useDeleteSubLine() {
  const qc = useQueryClient();
  const shared = optimistic(qc);
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/api/budgets/sub-lines?id=${id}`, { method: "DELETE" }),
    // ponytail: the row goes on the click and comes back if the DELETE fails,
    // which is the only news a removed row can carry — the inline error the
    // other sub-line actions show has no row left to sit on. Give the list a
    // shared error line if a silent restore ever confuses anyone.
    onMutate: async (id) => {
      await shared.begin();
      return patchCaches(qc, (data) =>
        patchBudget(data, (allocations) =>
          allocations.map((a) =>
            hasLine(a.subLines, id)
              ? withSubLines(a, removeLine(a.subLines, id))
              : a,
          ),
        ),
      );
    },
    onError: shared.onError,
    onSettled: shared.onSettled,
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
