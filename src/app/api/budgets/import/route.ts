import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import { budgets, budgetSubLines, categories, recurringTransactions } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { logDataEvent } from "@/lib/audit";
import { requireAccountAccess } from "@/lib/account-access";
import { resolveBudgetPlan } from "@/lib/budget-plan";
import { MAX_SUB_LINES_PER_ALLOCATION } from "@/lib/budget-sub-lines";
import { isFiniteNumber, isIsoDate, validateName, type ValidationFailure } from "@/lib/validation";
import {
  DEFAULT_CATEGORIES,
  defaultCategoryNames,
  isBudgetable,
} from "@/lib/default-categories";
import {
  MAX_IMPORT_ROWS,
  MAX_IMPORT_DEPTH,
  effectiveAmount,
  findOverAllocated,
  flattenTree,
  type ImportNode,
  type RowType,
} from "@/lib/budget-import";
import type { CategoryKind } from "@/types/api";

interface SkippedEntry {
  name: string;
  reason: "notBudgetable" | "tooManySubLines" | "kindConflict" | "alreadyBudgeted";
}

const ROOT_TYPES: Exclude<RowType, "skip">[] = ["variable", "fixed", "income", "categoryOnly"];
const FREQUENCIES = ["monthly", "yearly"] as const;

/** A validated root: the tree plus the per-root storage choice. */
type ImportRoot = ImportNode & {
  type: Exclude<RowType, "skip">;
  frequency: (typeof FREQUENCIES)[number];
};

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

/** Roots carry `type`/`frequency` on top of the node shape; both are allowlisted. */
function validateRoots(input: unknown): ImportRoot[] | ValidationFailure {
  const nodes = validateNodes(input, 0, { total: 0 });
  if ("error" in nodes) return nodes;
  const raw = input as { type?: unknown; frequency?: unknown }[];
  return nodes.map((node, i) => ({
    ...node,
    type: raw[i]?.type as ImportRoot["type"],
    frequency: (raw[i]?.frequency ?? "monthly") as ImportRoot["frequency"],
  }));
}

/** Every leaf of the subtree — one recurring plan each. A childless root is its own leaf. */
function leaves(node: ImportNode): ImportNode[] {
  return node.children.length ? node.children.flatMap(leaves) : [node];
}

// POST /api/budgets/import — bulk-create categories, allocations, sub-lines
// and recurring plans from a parsed spreadsheet tree (see budget-import.ts).
// The client does all Excel parsing; this endpoint only sees the canonical
// nodes. Import is only offered on a fresh budget, so this only ever CREATES:
// a root whose category already carries an allocation is reported, not merged.
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { budgetId, accountId, startDate, nodes: rawNodes } = body as {
      budgetId?: unknown;
      accountId?: unknown;
      startDate?: unknown;
      nodes?: unknown;
    };

    if (budgetId !== undefined && typeof budgetId !== "string") {
      return apiError("api.invalidBody", 400);
    }
    // Recurring plans need both, and the payload always carries them — the
    // wizard asks before submitting.
    if (typeof accountId !== "string" || !isIsoDate(startDate)) {
      return apiError("api.invalidBody", 400);
    }
    const nodes = validateRoots(rawNodes);
    if ("error" in nodes) {
      return apiError(nodes.error, 400, nodes.vars);
    }
    if (nodes.length === 0) {
      return apiError("api.invalidBody", 400);
    }
    for (const root of nodes) {
      if (!ROOT_TYPES.includes(root.type) || !FREQUENCIES.includes(root.frequency)) {
        return apiError("api.invalidBody", 400);
      }
      // Same rule as the sub-lines endpoint: children may leave a remainder,
      // never overspend. Without it effectiveAmount would quietly inflate the
      // allocation past what the sheet said the category costs.
      if (root.type !== "categoryOnly" && findOverAllocated(flattenTree([root])).length) {
        return apiError("api.subLinesExceedParent", 400);
      }
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

    // 404 when the caller can't see the account, 403 for viewers. A recurring
    // plan can't cross owner spaces, so the account must live in the same
    // space the imported rows land in.
    const access = await requireAccountAccess(userId, accountId, "write");
    if (access.account.userId !== dataUserId) {
      return apiError("api.accountNotFound", 404);
    }

    const existingCats = await db
      .select()
      .from(categories)
      .where(eq(categories.userId, dataUserId));
    const catByName = new Map(existingCats.map((c) => [c.name.toLowerCase(), c]));

    // Imported names that match a stock category (in any locale) inherit its
    // icon and color instead of the grey default.
    const stockByName = new Map<string, typeof DEFAULT_CATEGORIES[number]>();
    for (const d of DEFAULT_CATEGORIES) {
      for (const n of defaultCategoryNames(d.key)) stockByName.set(n.toLowerCase(), d);
    }

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

    // Recurring plans hang off the ACCOUNT, not off this budget plan, so a
    // fresh budget still meets the salary and the bills the user already set
    // up. Import only ever adds new plans: anything already on this account
    // under the same category and description is left as it is.
    const existingPlans = await db
      .select({
        categoryId: recurringTransactions.categoryId,
        description: recurringTransactions.description,
      })
      .from(recurringTransactions)
      .where(
        and(
          eq(recurringTransactions.userId, dataUserId),
          eq(recurringTransactions.accountId, accountId),
        ),
      );
    const planKey = (categoryId: string, description: string) =>
      `${categoryId}\u0000${description.trim().toLowerCase()}`;
    const existingPlanKeys = new Set(
      existingPlans
        .filter((p) => p.categoryId)
        .map((p) => planKey(p.categoryId!, p.description)),
    );

    let sortOrder = existingCats.length;
    let createdCategories = 0;
    let created = 0;
    let subLinesCreated = 0;
    let fixedPlansCreated = 0;
    let incomePlansCreated = 0;
    const skipped: SkippedEntry[] = [];
    const now = new Date().toISOString();

    // Declared outside the loop so it closes over dataUserId/now and the
    // counters without being rebuilt per root.
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

    // One transaction for the whole payload. An import is a single user action
    // over a tree the client already validated, so a failure on root 7 of 12
    // must not leave the categories and recurring plans of roots 1-6 behind
    // with nothing hanging off them — and "import is only offered on a fresh
    // budget" means there is no partial state worth keeping.
    await db.transaction(async (tx) => {
      for (const root of nodes) {
        const key = root.name.toLowerCase();
        const stock = stockByName.get(key);
        // Which side of the ledger this root asked for. `categoryOnly` is only
        // offered for income rows in the wizard.
        const wantedKind: CategoryKind =
          root.type === "income" || root.type === "categoryOnly" ? "income" : "expense";
        // What the category already is, or — for a name being imported for the
        // first time — what it would be created as. The stored kind wins: a user
        // who marked their own "Freelance" as income means it, and no stock
        // template knows about it.
        const kind = catByName.get(key)?.kind ?? stock?.kind ?? wantedKind;
        // isBudgetable still rules out transfers (they carry neither an
        // allocation nor a plan), but income is budgetable here.
        if (!isBudgetable(kind) && kind !== "income") {
          skipped.push({ name: root.name, reason: "notBudgetable" });
          continue;
        }
        // Backstop for the wizard's own warning: writing expense rows against an
        // income category (or vice versa) would misreport everywhere downstream.
        if (kind !== wantedKind) {
          skipped.push({ name: root.name, reason: "kindConflict" });
          continue;
        }

        let cat = catByName.get(key);
        if (!cat) {
          const values = {
            id: crypto.randomUUID(),
            userId: dataUserId,
            name: root.name,
            icon: stock?.icon ?? null,
            color: stock?.color ?? "#94a3b8",
            kind,
            sortOrder: sortOrder++,
            createdAt: now,
          };
          await tx.insert(categories).values(values);
          cat = values;
          catByName.set(key, cat);
          createdCategories++;
        }
        const categoryId = cat.id;

        if (root.type === "categoryOnly") continue;
        // An already-budgeted category is out of scope for import: the budgets
        // page sums allocations and fixed costs into one total, so anything added
        // on top would double-count. The wizard reports these back to the user.
        if (allocByCategory.has(categoryId)) {
          skipped.push({ name: root.name, reason: "alreadyBudgeted" });
          continue;
        }

        if (root.type === "fixed" || root.type === "income") {
          const isIncome = root.type === "income";
          // Section headers hold no amount of their own; leaves by definition do.
          const candidates = leaves(root).filter((leaf) => (leaf.amount ?? 0) > 0);
          const fresh = candidates.filter(
            (leaf) => !existingPlanKeys.has(planKey(categoryId, leaf.name)),
          );
          // Every plan this root would create is already on the account — say so
          // rather than reporting a silent zero.
          if (candidates.length && !fresh.length) {
            skipped.push({ name: root.name, reason: "alreadyBudgeted" });
            continue;
          }
          const rows = fresh.map((leaf) => {
            existingPlanKeys.add(planKey(categoryId, leaf.name));
            return {
              id: crypto.randomUUID(),
              userId: dataUserId,
              accountId,
              description: leaf.name,
              // Same sign convention as POST /api/recurring.
              amount: isIncome ? leaf.amount! : -leaf.amount!,
              type: isIncome ? ("income" as const) : ("expense" as const),
              categoryId,
              frequency: root.frequency,
              dayOfWeek: null,
              dayOfMonth: null,
              monthOfYear: null,
              startDate,
              endDate: null,
              isActive: true,
              createdAt: now,
            };
          });
          if (rows.length) {
            await tx.insert(recurringTransactions).values(rows);
            if (isIncome) incomePlansCreated += rows.length;
            else fixedPlansCreated += rows.length;
          }
          continue;
        }

        // Room under the per-allocation cap; creations beyond it are skipped.
        const budgetState = { room: MAX_SUB_LINES_PER_ALLOCATION, capHit: false };
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
        // A duplicate root name later in the payload is reported as
        // alreadyBudgeted instead of inserting a second allocation.
        allocByCategory.set(categoryId, values);
        for (const child of root.children) {
          await createSubTree(tx, child, allocationId, null, budgetState);
        }
        created++;
        if (budgetState.capHit) {
          skipped.push({ name: root.name, reason: "tooManySubLines" });
        }
      }
    });

    logDataEvent({
      userId,
      action: "budget_import",
      targetType: "budget",
      details: {
        createdCategories,
        created,
        subLinesCreated,
        fixedPlansCreated,
        incomePlansCreated,
        skipped: skipped.length,
        ...(dataUserId !== userId ? { accountOwnerId: dataUserId } : {}),
      },
    });

    return NextResponse.json({
      createdCategories,
      created,
      subLinesCreated,
      fixedPlansCreated,
      incomePlansCreated,
      skipped,
    });
  }, "Failed to import budget");
}
