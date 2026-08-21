import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiFetch } from "@/lib/api";
import { useAccounts } from "@/hooks/use-accounts";
import type {
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

export function useCreateCategory(accountId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
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
    onSuccess: () => {
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

export function useCategoryRules() {
  return useQuery({
    queryKey: ["category-rules"],
    queryFn: () => apiFetch<RuleWithCategory[]>("/api/categories/rules"),
    staleTime: 60 * 1000,
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
