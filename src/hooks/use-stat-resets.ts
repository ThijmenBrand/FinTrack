import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { StatResetData } from "@/types/api";

export function useStatResets() {
  return useQuery({
    queryKey: ["stat-resets"],
    queryFn: () => apiFetch<StatResetData[]>("/api/stat-resets"),
    staleTime: 5 * 60 * 1000,
  });
}

/** The newest reset date — the one that governs every average. */
export function useStatsCutoff(): string | null {
  const { data } = useStatResets();
  return data?.[0]?.date ?? null;
}

function useStatResetMutation<TArgs>(
  mutationFn: (args: TArgs) => Promise<StatResetData[]>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (resets) => {
      qc.setQueryData(["stat-resets"], resets);
      // Every backward-looking number is now computed from a different date.
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
      qc.invalidateQueries({ queryKey: ["preferences"] });
    },
  });
}

export function useAddStatReset() {
  return useStatResetMutation((input: { date: string; note?: string }) =>
    apiFetch<StatResetData[]>("/api/stat-resets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export function useDeleteStatReset() {
  return useStatResetMutation((id: string) =>
    apiFetch<StatResetData[]>(`/api/stat-resets?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  );
}
