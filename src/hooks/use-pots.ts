import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Pot, PotBudgetLineInput, PotBudgetTree, PotDetails } from "@/types/api";

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
