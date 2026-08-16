/**
 * The rules a budget sub-line tree has to obey, in one place: both the
 * sub-lines endpoint and the allocation endpoint check them, and the client
 * mirrors the depth cap when it renders.
 */
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { db } from "@/db";
import { budgetSubLines } from "@/db/schema";

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
  exceedsParent: "sub_line_exceeds_parent",
  belowChildren: "sub_line_below_children",
  tooDeep: "sub_line_too_deep",
  tooMany: "sub_line_too_many",
} as const;

/** English fallbacks, paired with the codes above for non-UI callers. */
export const SUB_LINE_ERROR_MESSAGE: Record<string, string> = {
  [SUB_LINE_ERROR.exceedsParent]: "Sub-lines cannot exceed their parent amount",
  [SUB_LINE_ERROR.belowChildren]: "Amount is below the total of its sub-lines",
  [SUB_LINE_ERROR.tooDeep]: `Sub-lines can only nest ${MAX_SUB_LINE_DEPTH} levels deep`,
  [SUB_LINE_ERROR.tooMany]: `An allocation can hold at most ${MAX_SUB_LINES_PER_ALLOCATION} sub-lines`,
};

/**
 * These helpers only read, so a transaction handle satisfies them too — which
 * is the point: the cap checks and the write they guard must see one snapshot.
 */
type Reader = Pick<typeof db, "select">;

/**
 * Total of everything sharing a container: `parentId` null means the
 * allocation's own root row set. `excludeId` leaves the row being updated out,
 * so its new amount can be tested against its siblings alone.
 */
export async function sumSiblings(
  reader: Reader,
  allocationId: string,
  userId: string,
  parentId: string | null,
  excludeId?: string,
): Promise<number> {
  const [row] = await reader
    .select({ total: sql<number>`coalesce(sum(${budgetSubLines.amount}), 0)` })
    .from(budgetSubLines)
    .where(
      and(
        eq(budgetSubLines.allocationId, allocationId),
        eq(budgetSubLines.userId, userId),
        parentId === null
          ? isNull(budgetSubLines.parentId)
          : eq(budgetSubLines.parentId, parentId),
        ...(excludeId ? [ne(budgetSubLines.id, excludeId)] : []),
      ),
    );
  return row?.total ?? 0;
}

/** Total of one sub-line's direct children — the floor it cannot shrink below. */
export async function sumChildren(
  reader: Reader,
  id: string,
  userId: string,
): Promise<number> {
  const [row] = await reader
    .select({ total: sql<number>`coalesce(sum(${budgetSubLines.amount}), 0)` })
    .from(budgetSubLines)
    .where(and(eq(budgetSubLines.parentId, id), eq(budgetSubLines.userId, userId)));
  return row?.total ?? 0;
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
