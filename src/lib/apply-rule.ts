import { db } from "@/db";
import { accounts, categories, transactions } from "@/db/schema";
import { and, eq, notExists, or, sql } from "drizzle-orm";

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
  /**
   * The user's transfer-bucket ids (loadTransferCategories), when the caller
   * applies many rules in a row — saves a category lookup per rule.
   */
  transferCategoryIds?: ReadonlySet<string>;
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
  transferCategoryIds,
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

  // A transfer bucket stays off rows the account policy rules out as a
  // transfer — the SQL twin of transferRuledOut in detect-transfers: the row's
  // own account, or the one its counterparty IBAN names, holds shared money.
  const isTransferBucket = transferCategoryIds
    ? transferCategoryIds.has(categoryId)
    : (
        await db
          .select({ kind: categories.kind })
          .from(categories)
          .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
      ).at(0)?.kind === "transfer";
  // Both IBANs normalized the way normalizeIban does it (spaces out, upper
  // case), so a row stored before normalization still meets its account.
  const policyCondition = isTransferBucket
    ? notExists(
        db
          .select({ one: sql`1` })
          .from(accounts)
          .where(
            and(
              eq(accounts.userId, userId),
              eq(accounts.internalTransfers, false),
              or(
                eq(accounts.id, transactions.accountId),
                eq(
                  sql`UPPER(REPLACE(${accounts.iban}, ' ', ''))`,
                  sql`UPPER(REPLACE(${transactions.counterpartyIban}, ' ', ''))`,
                ),
              ),
            ),
          ),
      )
    : undefined;

  const result = await db
    .update(transactions)
    .set({ categoryId, categorySource: "rule", categoryLabel: null })
    .where(and(condition, policyCondition));
  return result.rowsAffected;
}
