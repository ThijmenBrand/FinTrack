import { apiFetch } from "@/lib/api";
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
  /** Local sub-line id → the id the server issued for it in this run. */
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
      ...(step.children.length > 0 ? { children: step.children } : {}),
    });
    return;
  }

  if (step.kind === "recurring") {
    const tx = step.tx;
    await post("/api/recurring", "POST", {
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
