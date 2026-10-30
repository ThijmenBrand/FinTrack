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
  potBudgetLines,
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
import type { PotBudgetTree, PotBudgetView } from "@/types/api";

type Reader = Pick<typeof db, "select">;
/** Reads and writes — hand in a transaction handle so a replace is atomic. */
type Writer = Pick<typeof db, "select" | "insert" | "update" | "delete">;

/** Each pot's budget lines as a tree. Pots without lines are absent. */
export async function loadPotTrees(
  reader: Reader,
  userId: string,
  potIds: readonly string[],
): Promise<Map<string, PotLineNode[]>> {
  const trees = new Map<string, PotLineNode[]>();
  if (potIds.length === 0) return trees;
  const ids = [...potIds];

  const [lineRows, catRows] = await Promise.all([
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
  ]);

  const catsByLine = new Map<string, string[]>();
  for (const c of catRows) {
    const list = catsByLine.get(c.lineId);
    if (list) list.push(c.categoryId);
    else catsByLine.set(c.lineId, [c.categoryId]);
  }

  const byPot = new Map<string, StoredPotLine[]>();
  for (const r of lineRows) {
    const line: StoredPotLine = {
      id: r.id,
      parentId: r.parentId,
      name: r.name,
      amount: r.amount,
      sortOrder: r.sortOrder,
      categoryIds: catsByLine.get(r.id) ?? [],
    };
    const list = byPot.get(r.potId);
    if (list) list.push(line);
    else byPot.set(r.potId, [line]);
  }
  for (const [potId, rows] of byPot) trees.set(potId, buildLineTree(rows));
  return trees;
}

/**
 * Signed spend per category for each pot — the way budgets count it: funding
 * transfers left out, split parents left out (their children carry the
 * money), refunds and reimbursements netted in.
 */
export async function loadPotCategoryNets(
  reader: Reader,
  userId: string,
  potIds: readonly string[],
): Promise<Map<string, CategoryNet[]>> {
  const nets = new Map<string, CategoryNet[]>();
  if (potIds.length === 0) return nets;

  const rows = await reader
    .select({
      potId: transactions.groupId,
      categoryId: transactions.categoryId,
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
    .groupBy(transactions.groupId, transactions.categoryId);

  for (const r of rows) {
    if (!r.potId) continue;
    const entry = { categoryId: r.categoryId, net: Number(r.net) || 0 };
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
    .delete(potBudgetLineCategories)
    .where(and(eq(potBudgetLineCategories.potId, potId), eq(potBudgetLineCategories.userId, userId)));
  await writer
    .delete(potBudgetLines)
    .where(and(eq(potBudgetLines.potId, potId), eq(potBudgetLines.userId, userId)));
}

/**
 * Swap a pot's whole budget for `value` (already validated) and set the total
 * on the pot. Clearing the total resets funding, the same as clearing a
 * target through the pot form does.
 */
export async function replacePotBudget(
  writer: Writer,
  userId: string,
  potId: string,
  value: PotBudgetTree,
): Promise<void> {
  await deletePotBudgetLines(writer, userId, potId);

  const lineRows: (typeof potBudgetLines.$inferInsert)[] = [];
  const catRows: (typeof potBudgetLineCategories.$inferInsert)[] = [];
  value.lines.forEach((line, i) => {
    const id = crypto.randomUUID();
    lineRows.push({ id, userId, potId, parentId: null, name: line.name, amount: line.amount, sortOrder: i });
    for (const categoryId of line.categoryIds) catRows.push({ userId, potId, lineId: id, categoryId });
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
      for (const categoryId of child.categoryIds) catRows.push({ userId, potId, lineId: childId, categoryId });
    });
  });
  // Parents first: a child's parent_id must already exist when FKs are on.
  if (lineRows.length > 0) await writer.insert(potBudgetLines).values(lineRows);
  if (catRows.length > 0) await writer.insert(potBudgetLineCategories).values(catRows);

  await writer
    .update(transactionGroups)
    .set(value.total === null ? { targetAmount: null, fundedAmount: 0 } : { targetAmount: value.total })
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
