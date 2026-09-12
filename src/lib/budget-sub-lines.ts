/**
 * The rules a budget sub-line tree has to obey, in one place: both the
 * sub-lines endpoint and the allocation endpoint check them, and the client
 * mirrors the depth cap when it renders.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { db } from "@/db";
import { budgets, budgetSubLines } from "@/db/schema";

/** Deepest tree the API accepts; level 1 hangs directly off the allocation. */
export const MAX_SUB_LINE_DEPTH = 3;

/**
 * Upper bound on rows under one allocation. Not a design limit — a bound, so a
 * runaway client can't grow a tree that every budgets page then has to load.
 */
export const MAX_SUB_LINES_PER_ALLOCATION = 100;

/**
 * Machine-readable reasons, so the client can translate instead of printing
 * the endpoint's English back at a Dutch user.
 */
export const SUB_LINE_ERROR = {
  tooDeep: "sub_line_too_deep",
  tooMany: "sub_line_too_many",
} as const;

/** English fallbacks, paired with the codes above for non-UI callers. */
export const SUB_LINE_ERROR_MESSAGE: Record<string, string> = {
  [SUB_LINE_ERROR.tooDeep]: `Sub-lines can only nest ${MAX_SUB_LINE_DEPTH} levels deep`,
  [SUB_LINE_ERROR.tooMany]: `An allocation can hold at most ${MAX_SUB_LINES_PER_ALLOCATION} sub-lines`,
};

/**
 * These helpers only read, so a transaction handle satisfies them too — which
 * is the point: the cap checks and the write they guard must see one snapshot.
 */
type Reader = Pick<typeof db, "select">;

/** Reads and writes, so only a transaction handle should be handed in. */
type Writer = Pick<typeof db, "select" | "update">;

/**
 * How much one container holds and how many rows it holds it in — both in a
 * single statement, because the roll-up needs the count to tell "children sum
 * to zero" from "no children at all".
 * `parentId` null means the allocation's own root row set.
 */
async function containerTotal(
  reader: Reader,
  allocationId: string,
  userId: string,
  parentId: string | null,
): Promise<{ total: number; count: number }> {
  const [row] = await reader
    .select({
      total: sql<number>`coalesce(sum(${budgetSubLines.amount}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(budgetSubLines)
    .where(
      and(
        eq(budgetSubLines.allocationId, allocationId),
        eq(budgetSubLines.userId, userId),
        parentId === null
          ? isNull(budgetSubLines.parentId)
          : eq(budgetSubLines.parentId, parentId),
      ),
    );
  return { total: row?.total ?? 0, count: Number(row?.count ?? 0) };
}

/**
 * Push a change up the tree: re-sum the line's parent chain, then the
 * allocation itself from its root lines. No-op above a container that has no
 * children left — the last child's removal leaves the parent's amount where it
 * was rather than zeroing a budget.
 *
 * Runs inside the caller's transaction and never opens its own: reading a sum
 * and writing the parent it feeds must see one snapshot.
 */
export async function resyncUpwards(
  tx: Writer,
  allocationId: string,
  userId: string,
  fromParentId: string | null,
): Promise<void> {
  let cursor: string | null = fromParentId;
  // Bounded like subLineDepth: a parentId that shouldn't be reachable can't
  // spin this forever, it just stops climbing.
  for (let level = 0; cursor !== null && level < MAX_SUB_LINE_DEPTH; level++) {
    const rows: { parentId: string | null }[] = await tx
      .select({ parentId: budgetSubLines.parentId })
      .from(budgetSubLines)
      .where(and(eq(budgetSubLines.id, cursor), eq(budgetSubLines.userId, userId)))
      .limit(1);
    if (rows.length === 0) break;

    const { total, count } = await containerTotal(tx, allocationId, userId, cursor);
    if (count > 0) {
      await tx
        .update(budgetSubLines)
        .set({ amount: total })
        .where(and(eq(budgetSubLines.id, cursor), eq(budgetSubLines.userId, userId)));
    }
    cursor = rows[0].parentId;
  }

  const roots = await containerTotal(tx, allocationId, userId, null);
  if (roots.count > 0) {
    await tx
      .update(budgets)
      .set({ amount: roots.total })
      .where(and(eq(budgets.id, allocationId), eq(budgets.userId, userId)));
  }
}

/** How many rows the allocation's whole tree already holds. */
export async function countSubLines(
  reader: Reader,
  allocationId: string,
  userId: string,
): Promise<number> {
  const [row] = await reader
    .select({ total: sql<number>`count(*)` })
    .from(budgetSubLines)
    .where(
      and(
        eq(budgetSubLines.allocationId, allocationId),
        eq(budgetSubLines.userId, userId),
      ),
    );
  return row?.total ?? 0;
}

/**
 * Depth of an existing sub-line: 1 for a direct child of the allocation.
 * Walks `parentId` upward, bounded by the cap so a cycle that shouldn't be
 * possible can't spin forever — it reports "too deep" instead of hanging.
 */
export async function subLineDepth(
  reader: Reader,
  id: string,
  userId: string,
): Promise<number> {
  let cursor: string | null = id;
  for (let depth = 1; depth <= MAX_SUB_LINE_DEPTH; depth++) {
    const rows: { parentId: string | null }[] = await reader
      .select({ parentId: budgetSubLines.parentId })
      .from(budgetSubLines)
      .where(and(eq(budgetSubLines.id, cursor), eq(budgetSubLines.userId, userId)))
      .limit(1);
    const parentId = rows[0]?.parentId ?? null;
    if (!parentId) return depth;
    cursor = parentId;
  }
  return MAX_SUB_LINE_DEPTH + 1;
}

/**
 * Every sub-line an owner may point a transaction at, as `id → categoryId`:
 * the category of the allocation the line hangs under. Both write paths (the
 * import commit and the categorize endpoint) check a submitted `subLineId`
 * against this map, so a line can only ever refine the category it actually
 * plans for.
 *
 * Scoped by owner rather than by plan: the id has to be in the ROW owner's
 * space or it is someone else's budget, and beyond that a line under the right
 * category in another of the owner's own plans is a harmless reference.
 * ponytail: owner-scoped; narrow to the account's plan if plans ever have to
 * keep their sub-lines to themselves.
 */
export async function subLineCategories(
  reader: Reader,
  userId: string,
): Promise<Map<string, string>> {
  const rows = await reader
    .select({ id: budgetSubLines.id, categoryId: budgets.categoryId })
    .from(budgetSubLines)
    .innerJoin(budgets, eq(budgets.id, budgetSubLines.allocationId))
    .where(eq(budgetSubLines.userId, userId));
  return new Map(rows.map((r) => [r.id, r.categoryId]));
}

/**
 * The sub-lines of one plan as a flat, pre-ordered list — each line directly
 * after the one it hangs under, carrying the depth a picker indents by. The
 * tree only ever exists to be walked in this order, so it is never built.
 */
export function flattenSubLines(
  rows: { id: string; parentId: string | null; name: string; categoryId: string }[],
): { id: string; categoryId: string; name: string; depth: number }[] {
  const byParent = new Map<string | null, typeof rows>();
  for (const row of rows) {
    const siblings = byParent.get(row.parentId);
    if (siblings) siblings.push(row);
    else byParent.set(row.parentId, [row]);
  }
  const out: { id: string; categoryId: string; name: string; depth: number }[] = [];
  // Bounded by the same cap the writes enforce, so a parent chain that
  // shouldn't be possible costs a missing row rather than a hung request.
  const walk = (parentId: string | null, depth: number) => {
    if (depth > MAX_SUB_LINE_DEPTH) return;
    for (const row of byParent.get(parentId) ?? []) {
      out.push({ id: row.id, categoryId: row.categoryId, name: row.name, depth });
      walk(row.id, depth + 1);
    }
  };
  walk(null, 1);
  return out;
}
