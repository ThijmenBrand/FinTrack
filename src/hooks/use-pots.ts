import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Pot, PotDetails } from "@/types/api";

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

interface PotMutationPayload {
  name: string;
  categoryId: string | null;
  targetAmount?: number | null;
  targetDate?: string | null;
}

export function useCreatePot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: PotMutationPayload) =>
      apiFetch("/api/pots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pots"] });
      qc.invalidateQueries({ queryKey: ["forecast"] });
    },
  });
}

export function useUpdatePot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { id: string } & Partial<PotMutationPayload>) =>
      apiFetch("/api/pots", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pots"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["forecast"] });
    },
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
