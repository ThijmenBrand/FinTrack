import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { TransactionAttachment } from "@/types/api";

export function useAttachments(transactionId: string | null | undefined) {
  return useQuery({
    queryKey: ["attachments", transactionId],
    queryFn: () =>
      apiFetch<{ attachments: TransactionAttachment[] }>(
        `/api/attachments?transactionId=${transactionId}`,
      ).then((r) => r.attachments),
    enabled: !!transactionId,
  });
}

/**
 * Upload one file. `transactionId` attaches it to an existing row;
 * `accountId` parks it for an import still in review, and the commit claims it.
 */
export function useUploadAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { file: File; transactionId?: string; accountId?: string }) => {
      const form = new FormData();
      form.append("file", vars.file);
      if (vars.transactionId) form.append("transactionId", vars.transactionId);
      if (vars.accountId) form.append("accountId", vars.accountId);
      // No Content-Type header: the browser has to set the multipart boundary.
      return apiFetch<{ attachment: TransactionAttachment }>("/api/attachments", {
        method: "POST",
        body: form,
      }).then((r) => r.attachment);
    },
    onSuccess: (_data, vars) => {
      if (vars.transactionId) {
        qc.invalidateQueries({ queryKey: ["attachments", vars.transactionId] });
      }
    },
  });
}

export function useDeleteAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; transactionId?: string }) =>
      apiFetch<{ success: boolean }>(`/api/attachments?id=${vars.id}`, {
        method: "DELETE",
      }),
    onSuccess: (_data, vars) => {
      if (vars.transactionId) {
        qc.invalidateQueries({ queryKey: ["attachments", vars.transactionId] });
      }
    },
  });
}
