import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { AdminUser, Invite } from "@/types/api";

const json = (method: string, payload: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

export function useAdminUsers() {
  return useQuery({
    queryKey: ["admin-users"],
    queryFn: () => apiFetch<AdminUser[]>("/api/admin/users"),
  });
}

export function useInvites() {
  return useQuery({
    queryKey: ["admin-invites"],
    queryFn: () => apiFetch<Invite[]>("/api/admin/invites"),
  });
}

function useInviteMutation<T>(mutationFn: (payload: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-invites"] }); },
  });
}

export function useCreateInvite() {
  return useInviteMutation((payload: { email: string; displayName?: string; isAdmin: boolean }) =>
    apiFetch("/api/admin/invites", json("POST", payload)));
}

export function useResendInvite() {
  return useInviteMutation((id: string) =>
    apiFetch("/api/admin/invites", json("PUT", { id })));
}

export function useRevokeInvite() {
  return useInviteMutation((id: string) =>
    apiFetch(`/api/admin/invites?id=${id}`, { method: "DELETE" }));
}

export function useUpdateUserEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { id: string; email?: string; emailVerified?: boolean }) =>
      apiFetch("/api/admin/users", json("PUT", payload)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-users"] }); },
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/api/admin/users?id=${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-users"] }); },
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (payload: { id: string; password: string }) =>
      apiFetch("/api/admin/users", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
  });
}

export function useSetBanned() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { id: string; banned: boolean; banReason?: string }) =>
      apiFetch("/api/admin/users", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-users"] }); },
  });
}

export function useAppSettings() {
  return useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => apiFetch<{ signupsEnabled: boolean }>("/api/admin/settings"),
  });
}

export function useUpdateAppSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { signupsEnabled: boolean }) =>
      apiFetch("/api/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-settings"] }); },
  });
}

export function useUpdateDisplayName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { id: string; displayUsername: string }) =>
      apiFetch("/api/admin/users", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-users"] }); },
  });
}
