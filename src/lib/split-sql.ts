import { eq, isNull } from "drizzle-orm";
import { transactions } from "@/db/schema";

/**
 * Spend/income/category/pot aggregates must skip split wrappers: once a
 * transaction is split, only its children carry categories and count.
 */
export function excludeSplitParents() {
  return eq(transactions.isSplitParent, false);
}

/**
 * Ledger/balance aggregates must skip split children: the parent is the real
 * bank row (it keeps `amount` and `balance`), and its children sum to the same
 * amount — counting both would double every split.
 */
export function excludeSplitChildren() {
  return isNull(transactions.parentTransactionId);
}
