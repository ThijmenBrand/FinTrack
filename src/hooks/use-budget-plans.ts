import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { BudgetPlanData } from "@/types/api";

export function useBudgetPlans() {
  return useQuery({
    queryKey: ["budget-plans"],
    queryFn: () => apiFetch<{ plans: BudgetPlanData[] }>("/api/budget-plans"),
  });
}

function useInvalidatePlans() {
  const qc = useQueryClient();
  // Plan changes move accounts between budgets, so every budget-scoped
  // query is potentially stale.
  return () => {
    qc.invalidateQueries({ queryKey: ["budget-plans"] });
    qc.invalidateQueries({ queryKey: ["budgets"] });
    qc.invalidateQueries({ queryKey: ["accounts"] });
  };
}

export function useCreateBudgetPlan() {
  const invalidate = useInvalidatePlans();
  return useMutation({
    mutationFn: (payload: { name: string; accountIds?: string[] }) =>
      apiFetch<{ success: boolean; id: string }>("/api/budget-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateBudgetPlan() {
  const invalidate = useInvalidatePlans();
  return useMutation({
    mutationFn: (payload: {
      id: string;
      name?: string;
      accountIds?: string[];
      isMain?: boolean;
    }) =>
      apiFetch("/api/budget-plans", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteBudgetPlan() {
  const invalidate = useInvalidatePlans();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/budget-plans?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}
