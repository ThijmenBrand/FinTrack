import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { UserPreferencesData } from "@/types/api";

export function usePreferences() {
  return useQuery({
    queryKey: ["preferences"],
    queryFn: () => apiFetch<UserPreferencesData>("/api/preferences"),
  });
}

export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<UserPreferencesData>) =>
      apiFetch<UserPreferencesData>("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    // Preferences drive controls the user just operated — the budget scope
    // selector above all. Waiting for the round trip to redraw them leaves the
    // control showing the old choice for as long as the network takes, which
    // reads as a click that did nothing. Patch the cache first, roll back if
    // the write fails.
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ["preferences"] });
      const previous = qc.getQueryData<UserPreferencesData>(["preferences"]);
      if (previous) {
        qc.setQueryData<UserPreferencesData>(["preferences"], { ...previous, ...patch });
      }
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) {
        qc.setQueryData<UserPreferencesData>(["preferences"], context.previous);
      }
    },
    // Settled, not success: a failed write still has to put the server's
    // version back on screen.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["preferences"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      // countCrossBudgetTransfers changes what per-budget insights count.
      qc.invalidateQueries({ queryKey: ["insights"] });
    },
  });
}
