import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import { budgets, budgetSubLines, categories } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { logDataEvent } from "@/lib/audit";
import { resolveBudgetPlan } from "@/lib/budget-plan";
import { MAX_SUB_LINES_PER_ALLOCATION } from "@/lib/budget-sub-lines";
import { isFiniteNumber, validateName, type ValidationFailure, MONEY_EPSILON } from "@/lib/validation";
import {
  DEFAULT_CATEGORIES,
  defaultCategoryNames,
  NON_BUDGETABLE_CATEGORY_NAMES,
} from "@/lib/default-categories";
import {
  MAX_IMPORT_ROWS,
  MAX_IMPORT_DEPTH,
  effectiveAmount,
  type ImportNode,
} from "@/lib/budget-import";

interface SkippedEntry {
  name: string;
  reason: "notBudgetable" | "tooManySubLines";
}

/**
 * Recursively validate the client's node tree into clean ImportNodes.
 * Amounts arrive monthly and absolute — the client resolves sheet units and
 * sign conventions before submitting. Returns an error string on the first
 * invalid node.
 */
function validateNodes(
  input: unknown,
  depth: number,
  counter: { total: number },
): ImportNode[] | ValidationFailure {
  if (!Array.isArray(input)) return { ok: false, error: "api.invalidBody" };
  const out: ImportNode[] = [];
  for (const item of input) {
    if (++counter.total > MAX_IMPORT_ROWS) {
      return { ok: false, error: "api.tooManyRowsSimple", vars: { max: MAX_IMPORT_ROWS } };
    }
    const raw = item as { name?: unknown; amount?: unknown; children?: unknown };
    const nameCheck = validateName(raw?.name);
    if (!nameCheck.ok) return nameCheck;
    const amount = raw?.amount ?? null;
    if (amount !== null && (!isFiniteNumber(amount) || amount < 0)) {
      return { ok: false, error: "api.amountsInvalid" };
    }
    let children: ImportNode[] = [];
    if (raw?.children !== undefined && (raw.children as unknown[])?.length) {
      if (depth + 1 >= MAX_IMPORT_DEPTH) {
        return { ok: false, error: "api.nodesTooDeep", vars: { max: MAX_IMPORT_DEPTH } };
      }
      const nested = validateNodes(raw.children, depth + 1, counter);
      if ("error" in nested) return nested;
      children = nested;
    }
    out.push({ name: nameCheck.value, amount: amount as number | null, children });
  }
  return out;
}

// POST /api/budgets/import — bulk-create categories, allocations and
// sub-lines from a parsed spreadsheet tree (see budget-import.ts). The client
// does all Excel parsing; this endpoint only sees the canonical nodes.
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { budgetId, nodes: rawNodes } = body as { budgetId?: unknown; nodes?: unknown };

    if (budgetId !== undefined && typeof budgetId !== "string") {
      return apiError("api.invalidBody", 400);
    }
    const nodes = validateNodes(rawNodes, 0, { total: 0 });
    if ("error" in nodes) {
      return apiError(nodes.error, 400, nodes.vars);
    }
    if (nodes.length === 0) {
      return apiError("api.invalidBody", 400);
    }

    // Same tenant resolution as POST /api/budgets: rows (and the categories
    // they reference) land in the plan OWNER's space.
    const plan = await resolveBudgetPlan(userId, (budgetId as string | undefined) ?? null);
    if (budgetId && !plan) {
      return apiError("api.budgetNotFound", 404);
    }
    if (plan && plan.role === "viewer") {
      return apiError("api.readOnly", 403);
    }
    const dataUserId = plan?.ownerId ?? userId;

    const existingCats = await db
      .select()
      .from(categories)
      .where(eq(categories.userId, dataUserId));
    const catByName = new Map(existingCats.map((c) => [c.name.toLowerCase(), c]));

    // Imported names that match a stock category (in any locale) inherit its
    // icon and color instead of the grey default.
    const stockByName = new Map<string, { icon: string; color: string }>();
    for (const d of DEFAULT_CATEGORIES) {
      for (const n of defaultCategoryNames(d.key)) stockByName.set(n.toLowerCase(), d);
    }
    const nonBudgetable = new Set(
      NON_BUDGETABLE_CATEGORY_NAMES.map((n) => n.toLowerCase()),
    );

    const existingAllocs = await db
      .select()
      .from(budgets)
      .where(
        and(
          eq(budgets.userId, dataUserId),
          eq(budgets.status, "active"),
          plan ? eq(budgets.budgetId, plan.id) : sql`${budgets.budgetId} IS NULL`,
        ),
      );
    const allocByCategory = new Map(existingAllocs.map((a) => [a.categoryId, a]));

    let sortOrder = existingCats.length;
    let createdCategories = 0;
    let created = 0;
    let updated = 0;
    let subLinesCreated = 0;
    let subLinesUpdated = 0;
    const skipped: SkippedEntry[] = [];
    const now = new Date().toISOString();

    // Used by both branches below; declared here rather than in the loop so it
    // closes over dataUserId/now and the counters without being rebuilt per root.
    async function createSubTree(
      tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
      node: ImportNode,
      allocationId: string,
      parentId: string | null,
      state: { room: number; capHit: boolean },
    ): Promise<number> {
      if (state.room <= 0) {
        state.capHit = true;
        return 0;
      }
      state.room--;
      const id = crypto.randomUUID();
      const amount = effectiveAmount(node);
      await tx.insert(budgetSubLines).values({
        id,
        userId: dataUserId,
        allocationId,
        parentId,
        name: node.name,
        amount,
        createdAt: now,
      });
      subLinesCreated++;
      for (const child of node.children) {
        await createSubTree(tx, child, allocationId, id, state);
      }
      return amount;
    }

    for (const root of nodes) {
      const key = root.name.toLowerCase();
      if (nonBudgetable.has(key)) {
        skipped.push({ name: root.name, reason: "notBudgetable" });
        continue;
      }

      let cat = catByName.get(key);
      if (!cat) {
        const stock = stockByName.get(key);
        const values = {
          id: crypto.randomUUID(),
          userId: dataUserId,
          name: root.name,
          icon: stock?.icon ?? null,
          color: stock?.color ?? "#94a3b8",
          sortOrder: sortOrder++,
          createdAt: now,
        };
        await db.insert(categories).values(values);
        cat = values;
        catByName.set(key, cat);
        createdCategories++;
      }
      const categoryId = cat.id;

      const existing = allocByCategory.get(categoryId);
      // Allocation + sub-line tree change as one unit: partial writes would
      // leave sub-lines summing past their parent.
      await db.transaction(async (tx) => {
        // Room under the per-allocation cap; creations beyond it are skipped.
        const budgetState = {
          room: MAX_SUB_LINES_PER_ALLOCATION,
          capHit: false,
        };
        if (existing) {
          const subRows = await tx
            .select()
            .from(budgetSubLines)
            .where(
              and(
                eq(budgetSubLines.allocationId, existing.id),
                eq(budgetSubLines.userId, dataUserId),
              ),
            );
          budgetState.room -= subRows.length;
          const byParent = new Map<string | null, typeof subRows>();
          for (const r of subRows) {
            const list = byParent.get(r.parentId) ?? [];
            list.push(r);
            byParent.set(r.parentId, list);
          }

          // Reconcile one container: update name-matched rows, create missing
          // ones, leave unknown existing rows alone. Returns the container's
          // post-reconcile sum — the floor its parent cannot sit below.
          const reconcile = async (
            children: ImportNode[],
            parentId: string | null,
          ): Promise<number> => {
            const siblings = byParent.get(parentId) ?? [];
            const matched = new Set<string>();
            let sum = 0;
            for (const child of children) {
              const match = siblings.find(
                (s) => !matched.has(s.id) && s.name.toLowerCase() === child.name.toLowerCase(),
              );
              if (match) {
                matched.add(match.id);
                const childSum = await reconcile(child.children, match.id);
                const final = Math.max(child.amount ?? 0, childSum);
                if (Math.abs(final - match.amount) > MONEY_EPSILON) {
                  await tx
                    .update(budgetSubLines)
                    .set({ amount: final })
                    .where(
                      and(
                        eq(budgetSubLines.id, match.id),
                        eq(budgetSubLines.userId, dataUserId),
                      ),
                    );
                  subLinesUpdated++;
                }
                sum += final;
              } else {
                sum += await createSubTree(tx, child, existing.id, parentId, budgetState);
              }
            }
            for (const s of siblings) if (!matched.has(s.id)) sum += s.amount;
            return sum;
          };

          const rootSum = await reconcile(root.children, null);
          const finalAmount = Math.max(root.amount ?? 0, rootSum);
          if (Math.abs(finalAmount - existing.amount) > MONEY_EPSILON) {
            await tx
              .update(budgets)
              .set({ amount: finalAmount, source: "manual" })
              .where(and(eq(budgets.id, existing.id), eq(budgets.userId, dataUserId)));
          }
          updated++;
        } else {
          const allocationId = crypto.randomUUID();
          const values = {
            id: allocationId,
            budgetId: plan?.id ?? null,
            categoryId,
            amount: effectiveAmount(root),
            period: "monthly" as const,
            isActive: true,
            status: "active" as const,
            source: "manual" as const,
            generatedAt: null,
            createdAt: now,
            userId: dataUserId,
          };
          await tx.insert(budgets).values(values);
          // A duplicate root name later in the payload reconciles against
          // this row instead of inserting a second allocation.
          allocByCategory.set(categoryId, values);
          for (const child of root.children) {
            await createSubTree(tx, child, allocationId, null, budgetState);
          }
          created++;
        }
        if (budgetState.capHit) {
          skipped.push({ name: root.name, reason: "tooManySubLines" });
        }
      });
    }

    logDataEvent({
      userId,
      action: "budget_import",
      targetType: "budget",
      details: {
        createdCategories,
        created,
        updated,
        subLinesCreated,
        subLinesUpdated,
        skipped: skipped.length,
        ...(dataUserId !== userId ? { accountOwnerId: dataUserId } : {}),
      },
    });

    return NextResponse.json({
      createdCategories,
      created,
      updated,
      subLinesCreated,
      subLinesUpdated,
      skipped,
    });
  }, "Failed to import budget");
}
