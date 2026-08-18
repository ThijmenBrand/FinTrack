import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Profile } from "@/types/api";

export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: () => apiFetch<Profile>("/api/auth/profile"),
    staleTime: 60 * 1000,
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { displayName?: string; currentPassword?: string; newPassword?: string }) =>
      apiFetch("/api/auth/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}

export function useUploadAvatar() {
  const qc = useQueryClient();
  return useMutation({
    // Raw fetch, not apiFetch — FormData must set its own multipart boundary.
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return fetch("/api/auth/profile/avatar", { method: "POST", body }).then(async (res) => {
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error || res.statusText);
        }
        return res.json() as Promise<{ imageUrl: string }>;
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}

export function useDeleteAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch("/api/auth/profile/avatar", { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}
