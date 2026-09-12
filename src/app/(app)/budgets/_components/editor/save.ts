import { apiFetch } from "@/lib/api";
import type { BudgetChildInput } from "@/hooks/use-budgets";
import { afterSave, toSteps, type Draft, type Step } from "./draft";

/** What a run left behind: the draft that still has to happen, and why. */
export interface SaveResult {
  /** Empty when everything landed. */
  draft: Draft;
  /** How many of the steps were written. */
  saved: number;
  total: number;
  /** The step that refused, if one did. */
  failed?: Step;
  error?: string;
}

/**
 * Write the draft, one request at a time, stopping at the first refusal.
 *
 * Sequential rather than parallel because the order is load-bearing (see
 * `toSteps`): a category freed by a delete is only free once that delete
 * returns, and a sub-line can be the parent of the next one. A budget save is
 * a handful of requests, so there is nothing to win by racing them and a
 * consistency bug to lose.
 *
 * Plain `apiFetch`, not the optimistic mutation hooks: those each patch the
 * cache and refetch on settle, which for a twelve-change save would be twelve
 * refetches of the list this page is holding a draft over. The caller
 * invalidates once, at the end.
 */
export async function saveDraft(
  draft: Draft,
  budgetId: string | undefined,
): Promise<SaveResult> {
  const steps = toSteps(draft);
  /**
   * Local id → the id the server issued for it in this run. One map for both
   * kinds it holds — a sub-line's `line:…` and a recurring payment's
   * `draft:…` — since the two can never collide and every reader wants the
   * same question answered: what is this thing actually called now.
   */
  const idMap: Record<string, string> = {};
  const realId = (id: string) => idMap[id] ?? id;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    try {
      await run(step, budgetId, idMap, realId);
    } catch (err) {
      return {
        draft: afterSave(draft, steps, i, idMap),
        saved: i,
        total: steps.length,
        failed: step,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    draft: afterSave(draft, steps, steps.length, idMap),
    saved: steps.length,
    total: steps.length,
  };
}

async function run(
  step: Step,
  budgetId: string | undefined,
  idMap: Record<string, string>,
  realId: (id: string) => string,
): Promise<void> {
  if (step.kind === "remove") {
    await apiFetch(`/api/budgets?id=${encodeURIComponent(step.id)}`, {
      method: "DELETE",
    });
    return;
  }
  if (step.kind === "amount") {
    await post("/api/budgets", "PUT", { id: step.id, amount: step.amount });
    return;
  }
  if (step.kind === "create") {
    await post("/api/budgets", "POST", {
      categoryId: step.categoryId,
      amount: step.amount,
      budgetId,
      ...(step.children.length > 0 ? { children: adopted(step.children, realId) } : {}),
    });
    return;
  }

  if (step.kind === "recurring") {
    const tx = step.tx;
    // The id the server mints is what a line filed under this plan means when
    // it names it — drafted lines carry the local one.
    const created = await post<{ id: string }>("/api/recurring", "POST", {
      accountId: tx.accountId,
      description: tx.description,
      // Sent as stored — signed. The route re-signs it from `type` anyway.
      amount: tx.amount,
      type: tx.type,
      categoryId: tx.categoryId,
      frequency: tx.frequency,
      dayOfWeek: tx.dayOfWeek,
      dayOfMonth: tx.dayOfMonth,
      monthOfYear: tx.monthOfYear,
      startDate: tx.startDate,
    });
    if (created?.id) idMap[tx.id] = created.id;
    return;
  }

  const { op } = step;
  if (op.kind === "add") {
    // The id the server hands back is what every later op in this run means
    // when it names the line — including one nesting under it.
    const created = await post<{ id: string }>("/api/budgets/sub-lines", "POST", {
      allocationId: op.allocationId,
      parentId: op.parentId === null ? null : realId(op.parentId),
      name: op.name,
      amount: op.amount,
      // The line IS this plan: the endpoint takes its amount from there and
      // ignores the one above.
      ...(op.recurring ? { recurringId: realId(op.recurring.id) } : {}),
    });
    if (created?.id) idMap[op.id] = created.id;
    return;
  }
  if (op.kind === "update") {
    await post("/api/budgets/sub-lines", "PUT", {
      id: realId(op.id),
      name: op.name,
      amount: op.amount,
    });
    return;
  }
  await apiFetch(`/api/budgets/sub-lines?id=${encodeURIComponent(realId(op.id))}`, {
    method: "DELETE",
  });
}

function post<T>(url: string, method: string, body: unknown) {
  return apiFetch<T>(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * A submitted tree with every local plan id resolved. `toChildInput` runs
 * before the save does, so a line filed under a payment drafted in this same
 * session still names it by its `draft:…` id at that point — by the time the
 * create goes out, the payment has been written and has a real one.
 */
function adopted(
  children: readonly BudgetChildInput[],
  realId: (id: string) => string,
): BudgetChildInput[] {
  return children.map((child) => ({
    ...child,
    ...(child.adoptRecurringId
      ? { adoptRecurringId: realId(child.adoptRecurringId) }
      : {}),
    ...(child.children ? { children: adopted(child.children, realId) } : {}),
  }));
}
