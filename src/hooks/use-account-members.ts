import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { AccountMember, AccountRole } from "@/types/api";

/** The owner plus everyone invited to `accountId`. Null id disables the query. */
export function useAccountMembers(accountId: string | null) {
  return useQuery({
    queryKey: ["account-members", accountId],
    queryFn: () => apiFetch<AccountMember[]>(`/api/accounts/${accountId}/members`),
    enabled: !!accountId,
  });
}

function useInvalidateMembers(accountId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["account-members", accountId] });
    qc.invalidateQueries({ queryKey: ["accounts"] });
  };
}

export function useInviteMember(accountId: string) {
  const invalidate = useInvalidateMembers(accountId);
  return useMutation({
    mutationFn: (payload: { email: string; role: Exclude<AccountRole, "owner"> }) =>
      apiFetch(`/api/accounts/${accountId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateMemberRole(accountId: string) {
  const invalidate = useInvalidateMembers(accountId);
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: Exclude<AccountRole, "owner"> }) =>
      apiFetch(`/api/accounts/${accountId}/members/${memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      }),
    onSuccess: invalidate,
  });
}

export function useRevokeMember(accountId: string) {
  const invalidate = useInvalidateMembers(accountId);
  return useMutation({
    mutationFn: (memberId: string) =>
      apiFetch(`/api/accounts/${accountId}/members/${memberId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

/** Leave an account someone shared with you — DELETE /api/shares/{membershipId}. */
export function useLeaveShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (membershipId: string) =>
      apiFetch(`/api/shares/${membershipId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["account-members"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["budget-plans"] });
      qc.invalidateQueries({ queryKey: ["preferences"] });
    },
  });
}
