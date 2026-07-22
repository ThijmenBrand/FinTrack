import { db } from "@/db";
import { transactions } from "@/db/schema";
import { sql } from "drizzle-orm";

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
}

/**
 * Apply a categorization rule to the user's uncategorized income/expense
 * transactions: match on `LOWER(name — description)` and set categoryId +
 * categorySource='rule'. Returns the number of rows updated.
 */
export async function applyRuleToTransactions({
  pattern,
  categoryId,
  matchType,
  userId,
}: ApplyRuleOptions): Promise<number> {
  const type = normalizeMatchType(matchType);

  // Escape LIKE metacharacters so the pattern matches literally — the same
  // semantics as the client-side preview in csv-utils.matchesRule.
  const escaped = pattern.replace(/([\\%_])/g, "\\$1");
  const sqlPattern =
    type === "starts_with" ? `${escaped}%` : type === "exact" ? pattern : `%${escaped}%`;

  // Match against the combined "name — description" so legacy rows (name IS
  // NULL) match on description alone, and new rows match on either field.
  // Restrict to income/expense so transfers/reimbursements aren't reclassified.
  const matchTargetSql = sql`LOWER(IIF(${transactions.name} IS NOT NULL, ${transactions.name} || ' — ', '') || ${transactions.description})`;
  const condition =
    type === "exact"
      ? sql`${matchTargetSql} = LOWER(${pattern}) AND ${transactions.categoryId} IS NULL AND ${transactions.userId} = ${userId} AND ${transactions.type} IN ('income', 'expense')`
      : sql`${matchTargetSql} LIKE LOWER(${sqlPattern}) ESCAPE '\\' AND ${transactions.categoryId} IS NULL AND ${transactions.userId} = ${userId} AND ${transactions.type} IN ('income', 'expense')`;

  const result = await db
    .update(transactions)
    .set({ categoryId, categorySource: "rule" })
    .where(condition);
  return result.rowsAffected;
}
