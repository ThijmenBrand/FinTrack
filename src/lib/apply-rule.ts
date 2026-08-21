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
  /** "both" (default), "name" or "description" — see ruleMatchTarget. */
  matchField?: string;
  userId: string;
}

/**
 * Apply a categorization rule to the user's uncategorized income/expense
 * transactions: match on the text the rule's `matchField` names (title,
 * description, or both) and set categoryId + categorySource='rule'.
 * Returns the number of rows updated.
 */
export async function applyRuleToTransactions({
  pattern,
  categoryId,
  matchType,
  matchField,
  userId,
}: ApplyRuleOptions): Promise<number> {
  const type = normalizeMatchType(matchType);

  // Escape LIKE metacharacters so the pattern matches literally — the same
  // semantics as the client-side preview in csv-utils.matchesRule.
  const escaped = pattern.replace(/([\\%_])/g, "\\$1");
  const sqlPattern =
    type === "starts_with" ? `${escaped}%` : type === "exact" ? pattern : `%${escaped}%`;

  // Mirror ruleMatchTarget() in csv-utils — the import-time preview and this
  // DB-side apply must agree on what a rule looks at.
  // Restrict to income/expense so transfers/reimbursements aren't reclassified.
  const matchTargetSql =
    matchField === "name"
      ? sql`LOWER(IFNULL(${transactions.name}, ${transactions.description}))`
      : matchField === "description"
        ? sql`LOWER(IIF(${transactions.name} IS NOT NULL, ${transactions.description}, ''))`
        : sql`LOWER(IIF(${transactions.name} IS NOT NULL, ${transactions.name} || ' — ', '') || ${transactions.description})`;
  // A split parent's categoryId is cleared too (it's a pure wrapper, not
  // "uncategorized") — rules must never touch it, only its already-normal
  // children (see split-spec.md "Split rules"). isSplitParent = 0 keeps it out.
  const condition =
    type === "exact"
      ? sql`${matchTargetSql} = LOWER(${pattern}) AND ${transactions.categoryId} IS NULL AND ${transactions.isSplitParent} = 0 AND ${transactions.userId} = ${userId} AND ${transactions.type} IN ('income', 'expense')`
      : sql`${matchTargetSql} LIKE LOWER(${sqlPattern}) ESCAPE '\\' AND ${transactions.categoryId} IS NULL AND ${transactions.isSplitParent} = 0 AND ${transactions.userId} = ${userId} AND ${transactions.type} IN ('income', 'expense')`;

  const result = await db
    .update(transactions)
    .set({ categoryId, categorySource: "rule", categoryLabel: null })
    .where(condition);
  return result.rowsAffected;
}
