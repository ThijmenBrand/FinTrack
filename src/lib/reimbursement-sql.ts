import { sql } from "drizzle-orm";
import { transactions } from "@/db/schema";

/**
 * Effective expense amount for a transaction row: its absolute amount minus the
 * reimbursements linked to it (guarded to the same user).
 *
 * A reimbursement linked to N expenses is split pro-rata (1/N each) so it is
 * only subtracted once in aggregate, and the result is floored at 0 so an
 * over-reimbursed expense never produces negative spend.
 *
 * The correlated subquery references the outer `transactions` table by name, so
 * the query embedding this fragment must select FROM `transactions` unaliased
 * (every current caller does). Returns a `sql` fragment; wrap in `sum(...)` /
 * `CASE ... END` at the call site as needed.
 */
export function effectiveExpenseAmount() {
  return sql`MAX(abs(${transactions.amount}) - COALESCE(
    (SELECT SUM(r.amount / (SELECT COUNT(*) FROM reimbursement_links rl2 WHERE rl2.reimbursement_id = rl.reimbursement_id))
      FROM reimbursement_links rl
      JOIN transactions r ON r.id = rl.reimbursement_id AND r.user_id = "transactions"."user_id"
      WHERE rl.expense_id = "transactions"."id"),
    0
  ), 0)`;
}
