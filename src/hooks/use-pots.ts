import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Pot } from "@/types/api";

export function usePots() {
  return useQuery({
    queryKey: ["pots"],
    queryFn: () => apiFetch<Pot[]>("/api/pots"),
  });
}

export function useCreatePot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; categoryId: string | null }) =>
      apiFetch("/api/pots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pots"] }); },
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
