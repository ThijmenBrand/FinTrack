/**
 * Reads and writes for pot budgets. The rules live in `pot-budget.ts`; this
 * module only moves rows. Every statement names user_id (the tenant guard
 * refuses one that doesn't), and pot transactions are always the pot owner's
 * own rows — adding a transaction to a pot requires owning it — so scoping
 * transactions by user is exact, not an approximation.
 */
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { db } from "@/db";
import {
  categories,
  potBudgetLineCategories,
  potBudgetLinePotCategories,
  potBudgetLines,
  potCategories,
  transactionGroups,
  transactions,
} from "@/db/schema";
import { excludeSplitParents } from "@/lib/split-sql";
import {
  attributePotSpend,
  buildLineTree,
  toCents,
  type CategoryNet,
  type PotLineNode,
  type StoredPotLine,
} from "@/lib/pot-budget";
import type { PotBudgetTree, PotBudgetView, PotCategory } from "@/types/api";

type Reader = Pick<typeof db, "select">;
/** Reads and writes — hand in a transaction handle so a replace is atomic. */
type Writer = Pick<typeof db, "select" | "insert" | "update" | "delete">;

/**
 * The pot category a transaction row is narrowed to, as a correlated
 * subquery on "transactions" — null unless the row is still in that pot and
 * still has the pot category's parent as its own category. A dozen paths move
 * a row's category or pot without touching `pot_category_id`; checking the
 * triple on every read is the one place that can't be forgotten.
 */
export function validPotCategory(column: "id" | "name" = "id") {
  const pick = column === "id" ? sql`pc.id` : sql`pc.name`;
  return sql<string | null>`(
    SELECT ${pick} FROM pot_categories pc
    WHERE pc.id = ${transactions.potCategoryId}
      AND pc.user_id = "transactions"."user_id"
      AND pc.pot_id = ${transactions.groupId}
      AND pc.parent_category_id = ${transactions.categoryId}
  )`;
}

/** Each pot's budget lines as a tree. Pots without lines are absent. */
export async function loadPotTrees(
  reader: Reader,
  userId: string,
  potIds: readonly string[],
): Promise<Map<string, PotLineNode[]>> {
  const trees = new Map<string, PotLineNode[]>();
  if (potIds.length === 0) return trees;
  const ids = [...potIds];

  const [lineRows, catRows, potCatRows] = await Promise.all([
    reader
      .select({
        id: potBudgetLines.id,
        potId: potBudgetLines.potId,
        parentId: potBudgetLines.parentId,
        name: potBudgetLines.name,
        amount: potBudgetLines.amount,
        sortOrder: potBudgetLines.sortOrder,
      })
      .from(potBudgetLines)
      .where(and(eq(potBudgetLines.userId, userId), inArray(potBudgetLines.potId, ids))),
    reader
      .select({ lineId: potBudgetLineCategories.lineId, categoryId: potBudgetLineCategories.categoryId })
      .from(potBudgetLineCategories)
      .where(
        and(eq(potBudgetLineCategories.userId, userId), inArray(potBudgetLineCategories.potId, ids)),
      ),
    reader
      .select({
        lineId: potBudgetLinePotCategories.lineId,
        potCategoryId: potBudgetLinePotCategories.potCategoryId,
      })
      .from(potBudgetLinePotCategories)
      .where(
        and(
          eq(potBudgetLinePotCategories.userId, userId),
          inArray(potBudgetLinePotCategories.potId, ids),
        ),
      ),
  ]);

  const group = (rows: { lineId: string; id: string }[]) => {
    const byLine = new Map<string, string[]>();
    for (const r of rows) {
      const list = byLine.get(r.lineId);
      if (list) list.push(r.id);
      else byLine.set(r.lineId, [r.id]);
    }
    return byLine;
  };
  const catsByLine = group(catRows.map((c) => ({ lineId: c.lineId, id: c.categoryId })));
  const potCatsByLine = group(potCatRows.map((c) => ({ lineId: c.lineId, id: c.potCategoryId })));

  const byPot = new Map<string, StoredPotLine[]>();
  for (const r of lineRows) {
    const line: StoredPotLine = {
      id: r.id,
      parentId: r.parentId,
      name: r.name,
      amount: r.amount,
      sortOrder: r.sortOrder,
      categoryIds: catsByLine.get(r.id) ?? [],
      potCategoryIds: potCatsByLine.get(r.id) ?? [],
    };
    const list = byPot.get(r.potId);
    if (list) list.push(line);
    else byPot.set(r.potId, [line]);
  }
  for (const [potId, rows] of byPot) trees.set(potId, buildLineTree(rows));
  return trees;
}

/**
 * Signed spend per category (and pot category) for each pot — the way
 * budgets count it: funding transfers left out, split parents left out (their
 * children carry the money), refunds and reimbursements netted in.
 */
export async function loadPotCategoryNets(
  reader: Reader,
  userId: string,
  potIds: readonly string[],
): Promise<Map<string, CategoryNet[]>> {
  const nets = new Map<string, CategoryNet[]>();
  if (potIds.length === 0) return nets;

  const potCategoryId = validPotCategory();
  const rows = await reader
    .select({
      potId: transactions.groupId,
      categoryId: transactions.categoryId,
      potCategoryId,
      net: sql<number>`SUM(${transactions.amount})`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        inArray(transactions.groupId, [...potIds]),
        ne(transactions.type, "internal_transfer"),
        excludeSplitParents(),
      ),
    )
    .groupBy(transactions.groupId, transactions.categoryId, potCategoryId);

  for (const r of rows) {
    if (!r.potId) continue;
    const entry = { categoryId: r.categoryId, potCategoryId: r.potCategoryId, net: Number(r.net) || 0 };
    const list = nets.get(r.potId);
    if (list) list.push(entry);
    else nets.set(r.potId, [entry]);
  }
  return nets;
}

/** Budget progress for each pot passed in, keyed by pot id. */
export async function loadPotBudgetViews(
  reader: Reader,
  userId: string,
  pots: readonly { id: string; targetAmount: number | null }[],
): Promise<Map<string, PotBudgetView>> {
  const ids = pots.map((p) => p.id);
  const [trees, nets] = await Promise.all([
    loadPotTrees(reader, userId, ids),
    loadPotCategoryNets(reader, userId, ids),
  ]);
  return new Map(
    pots.map((p) => [p.id, attributePotSpend(p.targetAmount, trees.get(p.id) ?? [], nets.get(p.id) ?? [])]),
  );
}

/** Remove a pot's budget lines and their categories (not the total). */
export async function deletePotBudgetLines(writer: Writer, userId: string, potId: string): Promise<void> {
  await writer
    .delete(potBudgetLinePotCategories)
    .where(and(eq(potBudgetLinePotCategories.potId, potId), eq(potBudgetLinePotCategories.userId, userId)));
  await writer
    .delete(potBudgetLineCategories)
    .where(and(eq(potBudgetLineCategories.potId, potId), eq(potBudgetLineCategories.userId, userId)));
  await writer
    .delete(potBudgetLines)
    .where(and(eq(potBudgetLines.potId, potId), eq(potBudgetLines.userId, userId)));
}

/**
 * Swap a pot's whole budget for `value` (already validated) and set the total
 * on the pot — and the target date, when `opts.targetDate` is given (null
 * clears it). Clearing the total, or `opts.resetFunding`, zeroes what has been
 * set aside, the same as clearing a target through the pot form does.
 */
export async function replacePotBudget(
  writer: Writer,
  userId: string,
  potId: string,
  value: PotBudgetTree,
  opts: { targetDate?: string | null; resetFunding?: boolean } = {},
): Promise<void> {
  await deletePotBudgetLines(writer, userId, potId);

  const lineRows: (typeof potBudgetLines.$inferInsert)[] = [];
  const catRows: (typeof potBudgetLineCategories.$inferInsert)[] = [];
  const potCatRows: (typeof potBudgetLinePotCategories.$inferInsert)[] = [];
  const collect = (lineId: string, line: PotBudgetTree["lines"][number]) => {
    for (const categoryId of line.categoryIds) catRows.push({ userId, potId, lineId, categoryId });
    for (const potCategoryId of line.potCategoryIds ?? []) {
      potCatRows.push({ userId, potId, lineId, potCategoryId });
    }
  };
  value.lines.forEach((line, i) => {
    const id = crypto.randomUUID();
    lineRows.push({ id, userId, potId, parentId: null, name: line.name, amount: line.amount, sortOrder: i });
    collect(id, line);
    line.children.forEach((child, j) => {
      const childId = crypto.randomUUID();
      lineRows.push({
        id: childId,
        userId,
        potId,
        parentId: id,
        name: child.name,
        amount: child.amount,
        sortOrder: j,
      });
      collect(childId, child);
    });
  });
  // Parents first: a child's parent_id must already exist when FKs are on.
  if (lineRows.length > 0) await writer.insert(potBudgetLines).values(lineRows);
  if (catRows.length > 0) await writer.insert(potBudgetLineCategories).values(catRows);
  if (potCatRows.length > 0) await writer.insert(potBudgetLinePotCategories).values(potCatRows);

  await writer
    .update(transactionGroups)
    .set({
      targetAmount: value.total,
      ...(opts.targetDate !== undefined ? { targetDate: opts.targetDate } : {}),
      ...(value.total === null || opts.resetFunding ? { fundedAmount: 0 } : {}),
    })
    .where(and(eq(transactionGroups.id, potId), eq(transactionGroups.userId, userId)));
}

/** Whether every id names one of the user's categories. */
export async function userOwnsCategories(
  reader: Reader,
  userId: string,
  ids: readonly string[],
): Promise<boolean> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return true;
  const [row] = await reader
    .select({ n: sql<number>`count(*)` })
    .from(categories)
    .where(and(eq(categories.userId, userId), inArray(categories.id, unique)));
  return Number(row?.n ?? 0) === unique.length;
}

/** Sum of a pot's top-level lines in cents, or null when it has no lines. */
export async function topLevelPlannedCents(
  reader: Reader,
  userId: string,
  potId: string,
): Promise<number | null> {
  const [row] = await reader
    .select({ total: sql<number>`coalesce(sum(${potBudgetLines.amount}), 0)`, n: sql<number>`count(*)` })
    .from(potBudgetLines)
    .where(
      and(
        eq(potBudgetLines.userId, userId),
        eq(potBudgetLines.potId, potId),
        isNull(potBudgetLines.parentId),
      ),
    );
  if (!row || Number(row.n) === 0) return null;
  return toCents(Number(row.total));
}

/** Every category id a budget references, sub-lines included. */
export function budgetCategoryIds(value: PotBudgetTree): string[] {
  return value.lines.flatMap((l) => [...l.categoryIds, ...l.children.flatMap((c) => c.categoryIds)]);
}

/** Every pot category id a budget references, sub-lines included. */
export function budgetPotCategoryIds(value: PotBudgetTree): string[] {
  return value.lines.flatMap((l) => [
    ...(l.potCategoryIds ?? []),
    ...l.children.flatMap((c) => c.potCategoryIds ?? []),
  ]);
}

/** Whether every id names one of this pot's own categories. */
export async function potOwnsCategories(
  reader: Reader,
  userId: string,
  potId: string,
  ids: readonly string[],
): Promise<boolean> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return true;
  const [row] = await reader
    .select({ n: sql<number>`count(*)` })
    .from(potCategories)
    .where(
      and(
        eq(potCategories.userId, userId),
        eq(potCategories.potId, potId),
        inArray(potCategories.id, unique),
      ),
    );
  return Number(row?.n ?? 0) === unique.length;
}

/** A pot's own categories, by name. */
export async function listPotCategories(
  reader: Reader,
  userId: string,
  potId: string,
): Promise<PotCategory[]> {
  return reader
    .select({
      id: potCategories.id,
      potId: potCategories.potId,
      parentCategoryId: potCategories.parentCategoryId,
      name: potCategories.name,
    })
    .from(potCategories)
    .where(and(eq(potCategories.userId, userId), eq(potCategories.potId, potId)))
    .orderBy(potCategories.name);
}

/**
 * Delete pot categories picked by `scope` — a pot's, those under some parent
 * categories, or a few by id — and everything pointing at them: the lines
 * stop collecting them, the transactions go back to their parent category
 * alone. Explicit, since cascades aren't guaranteed on hosted libsql.
 */
export async function deletePotCategories(
  writer: Writer,
  userId: string,
  scope: { potId: string } | { parentCategoryIds: readonly string[] } | { ids: readonly string[] },
): Promise<void> {
  const where =
    "potId" in scope
      ? eq(potCategories.potId, scope.potId)
      : "parentCategoryIds" in scope
        ? inArray(potCategories.parentCategoryId, [...scope.parentCategoryIds])
        : inArray(potCategories.id, [...scope.ids]);
  if ("parentCategoryIds" in scope && scope.parentCategoryIds.length === 0) return;
  if ("ids" in scope && scope.ids.length === 0) return;

  const doomed = (
    await writer
      .select({ id: potCategories.id })
      .from(potCategories)
      .where(and(eq(potCategories.userId, userId), where))
  ).map((r) => r.id);
  if (doomed.length === 0) return;

  await writer
    .update(transactions)
    .set({ potCategoryId: null })
    .where(and(eq(transactions.userId, userId), inArray(transactions.potCategoryId, doomed)));
  await writer
    .delete(potBudgetLinePotCategories)
    .where(
      and(
        eq(potBudgetLinePotCategories.userId, userId),
        inArray(potBudgetLinePotCategories.potCategoryId, doomed),
      ),
    );
  await writer
    .delete(potCategories)
    .where(and(eq(potCategories.userId, userId), inArray(potCategories.id, doomed)));
}
