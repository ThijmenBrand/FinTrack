import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Account } from "@/types/api";

export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: () => apiFetch<Account[]>("/api/accounts"),
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; type: string; bank: string | null; bankName: string | null; iban: string | null; currency: string; initialBalance: number }) =>
      apiFetch("/api/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["accounts"] }); },
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { id: string; name: string; type: string; bank: string | null; bankName: string | null; iban: string | null; currency: string; initialBalance: number }) =>
      apiFetch("/api/accounts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["accounts"] }); },
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/api/accounts?id=${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
    },
  });
}

export function useReorderAccounts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderedIds: string[]) =>
      apiFetch("/api/accounts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderedIds }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["accounts"] }); },
  });
}
