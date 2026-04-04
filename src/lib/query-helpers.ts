import { sql } from "drizzle-orm";
import { transactions } from "@/db/schema";

/**
 * SQL subquery: sum of reimbursement amounts linked to an expense via the junction table.
 * Returns 0 if no reimbursements are linked.
 */
export const reimbursementSumSql = sql`COALESCE(
  (SELECT SUM(r.amount) FROM reimbursement_links rl
   JOIN transactions r ON r.id = rl.reimbursement_id
   WHERE rl.expense_id = ${transactions.id}),
  0
)`;

/**
 * SQL fragment that computes the effective amount for expense transactions.
 * For expenses that have reimbursements linked to them, the effective amount is:
 *   original_amount + SUM(reimbursement amounts)
 * (Since expenses are negative and reimbursements positive, this gives the net cost.)
 */
export const effectiveAmountSql = sql<number>`(
  ${transactions.amount} + ${reimbursementSumSql}
)`;

/**
 * SQL fragment for computing effective expense amounts in aggregations.
 *   abs(amount) - SUM(linked reimbursements)
 * This gives the net cost after paybacks.
 */
export const effectiveExpenseAbsSql = sql<number>`(
  abs(${transactions.amount}) - ${reimbursementSumSql}
)`;

/**
 * SQL condition to exclude reimbursement-type transactions from queries.
 */
export const excludeReimbursements = sql`${transactions.type} <> 'reimbursement'`;

/**
 * SQL condition to exclude transactions that belong to a pot (group).
 * These are accounted for via the pot's net amount instead.
 */
export const excludeGrouped = sql`${transactions.groupId} IS NULL`;
