import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Pot, PotBudgetLineInput, PotBudgetTree, PotCategory, PotDetails } from "@/types/api";

export function usePots() {
  return useQuery({
    queryKey: ["pots"],
    queryFn: () => apiFetch<Pot[]>("/api/pots"),
  });
}

export function usePotDetails(id: string | null) {
  return useQuery({
    queryKey: ["pots", id, "details"],
    queryFn: () => apiFetch<PotDetails>(`/api/pots/${id}/details`),
    enabled: !!id,
  });
}

/** A pot's budget as written — fetched on demand by "copy lines from…". */
export function potBudgetQuery(id: string) {
  return {
    queryKey: ["pots", id, "budget"],
    queryFn: () => apiFetch<PotBudgetTree>(`/api/pots/${id}/budget`),
  };
}

interface PotMutationPayload {
  name: string;
  categoryId: string | null;
  targetAmount?: number | null;
  targetDate?: string | null;
  archived?: boolean;
  /** Create only: budget lines saved with the pot. */
  lines?: PotBudgetLineInput[];
}

export function useCreatePot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: PotMutationPayload) =>
      apiFetch<{ success: boolean; id: string }>("/api/pots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pots"] });
      qc.invalidateQueries({ queryKey: ["recurring-forecast"] });
      qc.invalidateQueries({ queryKey: ["insights-balance"] });
    },
  });
}

export function useUpdatePot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { id: string } & Partial<PotMutationPayload>) =>
      apiFetch("/api/pots", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["pots"] }),
        qc.invalidateQueries({ queryKey: ["transactions"] }),
        qc.invalidateQueries({ queryKey: ["recurring-forecast"] }),
        qc.invalidateQueries({ queryKey: ["insights-balance"] }),
      ]),
  });
}

/** Replace a pot's whole budget; the total is its targetAmount. */
export function useSavePotBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...budget }: { id: string; targetDate?: string | null } & PotBudgetTree) =>
      apiFetch(`/api/pots/${id}/budget`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(budget),
      }),
    // Awaited, so the editor closes onto the saved budget, not the old one.
    onSuccess: () =>
      Promise.all([
        // ["pots"] prefix-matches the details and budget queries too.
        qc.invalidateQueries({ queryKey: ["pots"] }),
        qc.invalidateQueries({ queryKey: ["transactions"] }),
        qc.invalidateQueries({ queryKey: ["recurring-forecast"] }),
        qc.invalidateQueries({ queryKey: ["insights-balance"] }),
      ]),
  });
}

export function useAllocateToPot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { potId: string; amount: number }) =>
      apiFetch<{ success: boolean; fundedAmount: number }>("/api/pots/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pots"] });
      qc.invalidateQueries({ queryKey: ["recurring-forecast"] });
      qc.invalidateQueries({ queryKey: ["insights-balance"] });
    },
  });
}

export function useDeletePot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/api/pots?id=${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pots"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

export function useAddToPot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { potId: string; transactionId: string }) =>
      apiFetch("/api/pots/transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pots"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["pot-picker-transactions"] });
    },
  });
}

export function useRemoveFromPot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { potId: string; transactionId: string }) =>
      apiFetch(`/api/pots/transactions?potId=${payload.potId}&transactionId=${payload.transactionId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pots"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

const potCategoriesKey = (potId: string | null | undefined) => ["pots", potId ?? null, "categories"] as const;

/**
 * A pot's own categories. Every row of a pot asks with the same key, so a
 * list fetches each pot's once, and only once a picker for it opens.
 */
export function usePotCategories(potId: string | null | undefined, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: potCategoriesKey(potId),
    queryFn: () => apiFetch<PotCategory[]>(`/api/pots/${potId}/categories`),
    enabled: enabled && !!potId,
    staleTime: 60 * 1000,
  });
}

/**
 * Create a pot category, or get back the one already there under that parent
 * and name. Resolves once the pot's list holds it, so a picker can select it
 * straight away.
 */
export function useCreatePotCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ potId, ...body }: { potId: string; name: string; parentCategoryId: string }) =>
      apiFetch<PotCategory>(`/api/pots/${potId}/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: (created) => {
      qc.setQueryData<PotCategory[]>(potCategoriesKey(created.potId), (list) =>
        !list ? [created] : list.some((c) => c.id === created.id) ? list : [...list, created],
      );
      qc.invalidateQueries({ queryKey: ["pots", created.potId, "details"] });
    },
  });
}

export function useRenamePotCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ potId, categoryId, name }: { potId: string; categoryId: string; name: string }) =>
      apiFetch(`/api/pots/${potId}/categories`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId, name }),
      }),
    onSuccess: (_r, { potId }) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["pots", potId] }),
        qc.invalidateQueries({ queryKey: ["transactions"] }),
      ]),
  });
}

export function useDeletePotCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ potId, categoryId }: { potId: string; categoryId: string }) =>
      apiFetch(`/api/pots/${potId}/categories?categoryId=${encodeURIComponent(categoryId)}`, { method: "DELETE" }),
    onSuccess: (_r, { potId }) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["pots", potId] }),
        qc.invalidateQueries({ queryKey: ["transactions"] }),
      ]),
  });
}
