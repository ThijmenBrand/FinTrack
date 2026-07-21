import { sql } from "drizzle-orm";
import { transactions } from "@/db/schema";

/**
 * Effective expense amount for a transaction row: its absolute amount minus the
 * sum of any reimbursements linked to it (guarded to the same user).
 *
 * The correlated subquery references the outer `transactions` table by name, so
 * the query embedding this fragment must select FROM `transactions` unaliased
 * (every current caller does). Returns a `sql` fragment; wrap in `sum(...)` /
 * `CASE ... END` at the call site as needed.
 */
export function effectiveExpenseAmount() {
  return sql`abs(${transactions.amount}) - COALESCE(
    (SELECT SUM(r.amount) FROM reimbursement_links rl
      JOIN transactions r ON r.id = rl.reimbursement_id AND r.user_id = "transactions"."user_id"
      WHERE rl.expense_id = "transactions"."id"),
    0
  )`;
}
