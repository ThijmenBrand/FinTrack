import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiFetch } from "@/lib/api";
import { useAccounts } from "@/hooks/use-accounts";
import type {
  Account,
  CategoryKind,
  CategoryWithDetails,
  RuleWithCategory,
  SplitRuleWithLines,
} from "@/types/api";
import type { SplitRuleLineInput } from "@/hooks/use-transactions";

/** Pass `accountId` when categorizing rows on a specific (possibly shared)
 *  account — the list then comes from that account's owner. */
export function useCategories(accountId?: string) {
  return useQuery({
    queryKey: ["categories", accountId ?? null],
    queryFn: () =>
      apiFetch<CategoryWithDetails[]>(
        accountId ? `/api/categories?accountId=${encodeURIComponent(accountId)}` : "/api/categories",
      ),
    staleTime: 60 * 1000,
  });
}

/** Own categories plus those of owners sharing an account — for a list that
 *  spans accounts. Pick per row with the row account's owner. */
export function useVisibleCategories() {
  return useQuery({
    queryKey: ["categories", "visible"],
    queryFn: () => apiFetch<CategoryWithDetails[]>("/api/categories?scope=visible"),
    staleTime: 60 * 1000,
  });
}

const NO_CATEGORIES: CategoryWithDetails[] = [];

/**
 * For lists spanning several accounts: the categories each row may actually be
 * set to (its account OWNER's — a member's own ids are rejected on shared
 * rows), plus whether the caller owns the account, since rules are the owner's
 * config and the server drops rule creation from anyone else.
 */
export function useAccountCategories() {
  const { data: categories = [] } = useVisibleCategories();
  const { data: accounts = [] } = useAccounts();

  return useMemo(() => {
    const byOwner = new Map<string, CategoryWithDetails[]>();
    for (const cat of categories) {
      const list = byOwner.get(cat.userId);
      if (list) list.push(cat);
      else byOwner.set(cat.userId, [cat]);
    }
    // Grouped once so each row gets a stable array — the rows are memo'd.
    const byAccount = new Map(
      accounts.map((a) => [a.id, byOwner.get(a.userId) ?? NO_CATEGORIES]),
    );
    return {
      /** Everything visible — for filters and labels, not for writes. */
      categories,
      categoriesFor: (accountId: string) => byAccount.get(accountId) ?? NO_CATEGORIES,
      ownsAccount: (accountId: string) => {
        const account = accounts.find((a) => a.id === accountId);
        return !account || account.role === "owner";
      },
    };
  }, [categories, accounts]);
}

/**
 * Creates a category optimistically: the caller passes the `id`, so it can
 * select the new category before the request lands. The row goes into every
 * cached category list right away and is pulled back out if the POST fails.
 */
export function useCreateCategory(accountId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      id: string;
      name: string;
      color: string;
      icon: string | null;
      kind?: CategoryKind;
    }) =>
      apiFetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accountId ? { ...payload, accountId } : payload),
      }),
    onMutate: async (payload) => {
      await qc.cancelQueries({ queryKey: ["categories"] });
      const previous = qc.getQueriesData<CategoryWithDetails[]>({ queryKey: ["categories"] });

      // The owner decides which group the row lands in under ?scope=visible:
      // the account's owner when we're working on one, else our own — read off
      // our own cached list. An owner we can't resolve (nothing cached yet)
      // only costs the row its place in that grouped list.
      const accounts = qc.getQueryData<Account[]>(["accounts"]) ?? [];
      const userId =
        (accountId
          ? accounts.find((a) => a.id === accountId)?.userId
          : qc.getQueryData<CategoryWithDetails[]>(["categories", null])?.[0]?.userId) ?? "";

      const optimistic: CategoryWithDetails = {
        id: payload.id,
        name: payload.name,
        color: payload.color,
        icon: payload.icon,
        kind: payload.kind ?? "expense",
        userId,
        createdAt: new Date().toISOString(),
        transactionCount: 0,
        rules: [],
      };

      // Only the lists this category actually belongs to: the scope it was
      // created in, plus the cross-account one that groups by owner. Another
      // account's list would be showing someone else's category.
      const scope = accountId ?? null;
      for (const [key, data] of previous) {
        const keyScope = (key as [string, string | null])[1];
        if (!data || (keyScope !== scope && keyScope !== "visible")) continue;
        qc.setQueryData<CategoryWithDetails[]>(key, [...data, optimistic]);
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      // Anything already pointing at the rolled-back id falls back to its
      // "no category" state, since the id now matches nothing in the list.
      for (const [key, data] of ctx?.previous ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      id: string;
      // Every field is a partial update — the route only writes what it is
      // given, so a caller changing one thing sends only that thing.
      name?: string;
      color?: string;
      icon?: string | null;
      kind?: CategoryKind;
    }) =>
      apiFetch("/api/categories", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/api/categories?id=${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}

export function useBulkDeleteCategories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<{ deleted: number }>(
        `/api/categories?${ids.map((id) => `id=${encodeURIComponent(id)}`).join("&")}`,
        { method: "DELETE" }
      ),
    // onSettled so the cache refreshes even when the delete fails partway
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["category-rules"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}

export function useReorderCategories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderedIds: string[]) =>
      apiFetch("/api/categories", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderedIds }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["categories"] }); },
  });
}

/** Pass `enabled: false` to hold the fetch back — surfaces that only need the
 *  rules once a popover opens shouldn't make every row in a list subscribe. */
export function useCategoryRules(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["category-rules"],
    queryFn: () => apiFetch<RuleWithCategory[]>("/api/categories/rules"),
    staleTime: 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

export function useCreateCategoryRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { pattern: string; categoryId: string; matchType: string; matchField: string; applyToExisting?: boolean }) =>
      apiFetch<{ applied?: number }>("/api/categories/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["category-rules"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

export function useUpdateCategoryRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { id: string; pattern: string; matchType: string; matchField: string; categoryId: string; applyToExisting?: boolean }) =>
      apiFetch("/api/categories/rules", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["category-rules"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
    },
  });
}

export function useDeleteCategoryRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/api/categories/rules?id=${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["category-rules"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
    },
  });
}

/* Split rules — same shape of CRUD as the category rules above; creation lives
   in use-transactions (useCreateSplitRule), next to the manual-split flow. */

export function useSplitRules() {
  return useQuery({
    queryKey: ["split-rules"],
    queryFn: () => apiFetch<SplitRuleWithLines[]>("/api/split-rules"),
    staleTime: 60 * 1000,
  });
}

export function useUpdateSplitRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      id: string;
      pattern?: string;
      matchType?: string;
      matchField?: string;
      mode?: "percentage" | "fixed";
      lines?: SplitRuleLineInput[];
      isActive?: boolean;
      applyToExisting?: boolean;
    }) =>
      apiFetch<{ applied?: number }>("/api/split-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["split-rules"] });
      if (vars.applyToExisting) qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

export function useDeleteSplitRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/split-rules?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["split-rules"] });
    },
  });
}

export function useReapplyCategoryRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ transactionsCategorized: number; transactionsSplit: number; totalTransactions: number; uncategorized: number }>("/api/categories/rules/reapply", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
    },
  });
}
