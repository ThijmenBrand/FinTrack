import { db } from "@/db";
import { transactions, categories } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export type MatchType = "contains" | "exact" | "starts_with";

// Allowlist so an unexpected matchType can never pick an unintended branch.
// (The SQL is parameterized regardless; this keeps behavior well-defined.)
function normalizeMatchType(matchType: string): MatchType {
  return matchType === "exact" || matchType === "starts_with"
    ? matchType
    : "contains";
}

interface ApplyRuleOptions {
  pattern: string;
  categoryId: string;
  matchType: string;
  userId: string;
  /**
   * Whether the target category is reserved-kind (matched rows flip to
   * `type='reserved'`). Omit to look it up from `categories.kind`.
   */
  isReserved?: boolean;
}

/**
 * Apply a categorization rule to the user's uncategorized income/expense
 * transactions: match on `LOWER(name — description)`, set categoryId +
 * categorySource='rule', and flip type to 'reserved' for reserved categories.
 * Returns the number of rows updated.
 */
export async function applyRuleToTransactions({
  pattern,
  categoryId,
  matchType,
  userId,
  isReserved,
}: ApplyRuleOptions): Promise<number> {
  const type = normalizeMatchType(matchType);

  const sqlPattern =
    type === "starts_with" ? `${pattern}%` : type === "exact" ? pattern : `%${pattern}%`;

  if (isReserved === undefined) {
    const [targetCategory] = await db
      .select({ kind: categories.kind })
      .from(categories)
      .where(eq(categories.id, categoryId))
      .limit(1);
    isReserved = targetCategory?.kind === "reserved";
  }

  // Match against the combined "name — description" so legacy rows (name IS
  // NULL) match on description alone, and new rows match on either field.
  // Restrict to income/expense so transfers/reimbursements aren't reclassified.
  const matchTargetSql = sql`LOWER(IIF(${transactions.name} IS NOT NULL, ${transactions.name} || ' — ', '') || ${transactions.description})`;
  const condition =
    type === "exact"
      ? sql`${matchTargetSql} = LOWER(${pattern}) AND ${transactions.categoryId} IS NULL AND ${transactions.userId} = ${userId} AND ${transactions.type} IN ('income', 'expense')`
      : sql`${matchTargetSql} LIKE LOWER(${sqlPattern}) AND ${transactions.categoryId} IS NULL AND ${transactions.userId} = ${userId} AND ${transactions.type} IN ('income', 'expense')`;

  const updateSet: Record<string, unknown> = { categoryId, categorySource: "rule" };
  if (isReserved) updateSet.type = "reserved";

  const result = await db.update(transactions).set(updateSet).where(condition);
  return result.rowsAffected;
}
