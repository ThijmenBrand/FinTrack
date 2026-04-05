import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export function useHasPin() {
  return useQuery({
    queryKey: ["pin-status"],
    queryFn: () =>
      apiFetch<{ hasPin: boolean }>(`/api/auth/pin/status`),
    staleTime: 30 * 1000,
  });
}

export function useSetupPin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { pin: string; currentPassword: string }) =>
      apiFetch("/api/auth/pin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pin-status"] });
    },
  });
}

export function useRemovePin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { currentPassword: string }) =>
      apiFetch("/api/auth/pin/setup", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pin-status"] });
    },
  });
}

export function useUnlockPin() {
  return useMutation({
    mutationFn: (payload: { pin: string }) =>
      apiFetch<{ success: boolean }>("/api/auth/pin/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
  });
}

export function useInitialSetupPin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { pin: string }) =>
      apiFetch<{ success: boolean }>("/api/auth/pin/initial-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pin-status"] });
    },
  });
}
