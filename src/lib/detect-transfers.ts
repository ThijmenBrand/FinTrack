import { db as defaultDb } from "@/db";
import { transactions, categories } from "@/db/schema";
import { eq, and, notInArray } from "drizzle-orm";

/**
 * Detects internal transfers between accounts.
 * Logic: If money leaves Account A and enters Account B within ±2 days
 * with the same absolute amount, flag both as "Internal Transfer".
 */
export async function detectTransfers(db: typeof defaultDb, userId: string) {
  // Get the "Internal Transfer" category
  const [transferCategory] = await db
    .select()
    .from(categories)
    .where(
      and(eq(categories.name, "Internal Transfer"), eq(categories.userId, userId))
    );

  if (!transferCategory) {
    return { matchedPairs: 0, totalTransactionsUpdated: 0 };
  }

  // Find all transactions not yet flagged as transfers and not already
  // intentionally categorized as reserved (e.g. savings) — those aren't
  // candidates for transfer-pair detection.
  const excludedTypes: ("internal_transfer" | "reserved")[] = [
    "internal_transfer",
    "reserved",
  ];
  const allTx = await db
    .select()
    .from(transactions)
    .where(
      and(notInArray(transactions.type, excludedTypes), eq(transactions.userId, userId))
    );

  // Group by absolute amount for efficient matching
  const byAmount = new Map<number, typeof allTx>();
  for (const tx of allTx) {
    const absAmount = Math.round(Math.abs(tx.amount) * 100); // Use cents to avoid float issues
    if (!byAmount.has(absAmount)) byAmount.set(absAmount, []);
    byAmount.get(absAmount)!.push(tx);
  }

  let matchedPairs = 0;
  const alreadyMatched = new Set<string>();

  for (const [, group] of byAmount) {
    if (group.length < 2) continue;

    // Separate into debits (outgoing) and credits (incoming)
    const debits = group.filter((tx) => tx.amount < 0);
    const credits = group.filter((tx) => tx.amount > 0);

    for (const debit of debits) {
      if (alreadyMatched.has(debit.id)) continue;

      for (const credit of credits) {
        if (alreadyMatched.has(credit.id)) continue;

        // Must be different accounts
        if (debit.accountId === credit.accountId) continue;

        // Check date proximity: within ±2 days
        const debitDate = new Date(debit.date);
        const creditDate = new Date(credit.date);
        const daysDiff = Math.abs(
          (debitDate.getTime() - creditDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysDiff <= 2) {
          // Match found! Flag both as internal transfer
          alreadyMatched.add(debit.id);
          alreadyMatched.add(credit.id);

          await db
            .update(transactions)
            .set({
              type: "internal_transfer",
              categoryId: transferCategory.id,
              linkedTransactionId: credit.id,
            })
            .where(eq(transactions.id, debit.id));

          await db
            .update(transactions)
            .set({
              type: "internal_transfer",
              categoryId: transferCategory.id,
              linkedTransactionId: debit.id,
            })
            .where(eq(transactions.id, credit.id));

          matchedPairs++;
          break; // Move to next debit
        }
      }
    }
  }

  return { matchedPairs, totalTransactionsUpdated: matchedPairs * 2 };
}
