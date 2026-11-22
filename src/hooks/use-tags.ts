import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Tag } from "@/types/api";

/**
 * The tags a row on `accountId` may be given — its ACCOUNT OWNER's, since a
 * shared row carries the owner's tag ids and refuses a member's own. Without
 * an account it is the caller's own vocabulary.
 */
export function useTags(accountId?: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["tags", accountId ?? null],
    queryFn: () =>
      apiFetch<Tag[]>(
        accountId ? `/api/tags?accountId=${encodeURIComponent(accountId)}` : "/api/tags",
      ),
    staleTime: 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

/** Own tags plus those of owners sharing an account — for the filter bar,
 *  which spans accounts and only needs names to match against. */
export function useVisibleTags() {
  return useQuery({
    queryKey: ["tags", "visible"],
    queryFn: () => apiFetch<Tag[]>("/api/tags?scope=visible"),
    staleTime: 60 * 1000,
  });
}

/**
 * Create a tag. The caller passes the `id` so the picker can put it on the row
 * in the same gesture, without waiting for a round trip to learn what it is.
 *
 * Creating a name that already exists returns the existing tag rather than a
 * second one — same tag, same badge.
 */
export function useCreateTag(accountId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { id: string; name: string }) =>
      apiFetch<{ id: string; name: string }>("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accountId ? { ...payload, accountId } : payload),
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["tags"] });
    },
  });
}

export function useRenameTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { id: string; name: string }) =>
      apiFetch<Tag>("/api/tags", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["tags"] });
      // The name rides along on every transaction row that carries it.
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

/** Delete a tag outright — it comes off every row that carries it. */
export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ success: boolean }>(`/api/tags?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["tags"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

/** Put a tag on one transaction. */
export function useAddTransactionTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { transactionId: string; tagId: string }) =>
      apiFetch<{ success: boolean }>(
        `/api/transactions/${encodeURIComponent(vars.transactionId)}/tags`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tagId: vars.tagId }),
        },
      ),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      // Usage counts move with it.
      qc.invalidateQueries({ queryKey: ["tags"] });
    },
  });
}

/** Take a tag off one transaction; the tag itself stays in the vocabulary. */
export function useRemoveTransactionTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { transactionId: string; tagId: string }) =>
      apiFetch<{ success: boolean }>(
        `/api/transactions/${encodeURIComponent(vars.transactionId)}/tags?tagId=${encodeURIComponent(vars.tagId)}`,
        { method: "DELETE" },
      ),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["tags"] });
    },
  });
}
