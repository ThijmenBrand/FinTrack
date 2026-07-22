import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { PreviewTransaction } from "@/lib/csv-utils";

interface PreviewResult {
  transactions: PreviewTransaction[];
  skipped: number;
}

export function usePreviewUpload() {
  return useMutation({
    mutationFn: (formData: FormData) =>
      fetch("/api/transactions/upload/preview", { method: "POST", body: formData }).then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || res.statusText);
        }
        return res.json() as Promise<PreviewResult>;
      }),
  });
}

interface CommitResult {
  imported: number;
  duplicatesSkipped: number;
  rulesCreated: number;
  transfersDetected: number;
}

export function useCommitUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { accountId: string; fileName: string; transactions: unknown[]; newRules: unknown[] }) =>
      apiFetch<CommitResult>("/api/transactions/upload/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
    },
  });
}
