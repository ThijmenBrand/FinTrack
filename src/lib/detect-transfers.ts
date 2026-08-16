import { db as defaultDb } from "@/db";
import { transactions, categories } from "@/db/schema";
import { eq, and, notInArray, inArray, asc } from "drizzle-orm";
import { writableTransactions } from "@/lib/account-access";
import { defaultCategoryNames, TRANSFER_CATEGORY } from "@/lib/default-categories";

/**
 * The user's transfer bucket, matched across every locale's spelling. Oldest
 * row wins so the seeded category beats a later custom category that happens
 * to reuse another locale's name.
 */
export async function findTransferCategory(db: typeof defaultDb, userId: string) {
  const rows = await db
    .select()
    .from(categories)
    .where(
      and(inArray(categories.name, defaultCategoryNames(TRANSFER_CATEGORY)), eq(categories.userId, userId))
    )
    .orderBy(asc(categories.createdAt), asc(categories.id))
    .limit(1);
  return rows.at(0);
}

/**
 * Detects internal transfers between accounts.
 * Logic: If money leaves Account A and enters Account B within ±2 days
 * with the same absolute amount, flag both as "Internal Transfer".
 *
 * Scope is every transaction `userId` may WRITE — own rows plus rows on
 * accounts shared with them as editor — so a move between a private account
 * and a joint account gets paired from either side. Viewer-shared accounts
 * stay out: flagging only one leg of a pair is worse than flagging neither.
 */
export async function detectTransfers(db: typeof defaultDb, userId: string) {
  // Rows on a shared account keep the OWNER's user_id and live in the OWNER's
  // category space, so the transfer bucket is resolved per row owner, not per
  // caller — a cross-user pair gets each side its own user's category.
  const transferCategories = new Map<string, string | undefined>();
  const transferCategoryId = async (rowUserId: string) => {
    if (!transferCategories.has(rowUserId)) {
      transferCategories.set(rowUserId, (await findTransferCategory(db, rowUserId))?.id);
    }
    return transferCategories.get(rowUserId);
  };

  // Find all transactions not yet flagged as transfers.
  const excludedTypes: "internal_transfer"[] = ["internal_transfer"];
  const allTx = await db
    .select()
    .from(transactions)
    .where(and(notInArray(transactions.type, excludedTypes), writableTransactions(userId)));

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
          const debitCategoryId = await transferCategoryId(debit.userId);
          const creditCategoryId = await transferCategoryId(credit.userId);
          // No transfer bucket on either side: leave the pair alone rather
          // than flag half of it.
          if (!debitCategoryId || !creditCategoryId) continue;

          // Match found! Flag both as internal transfer
          alreadyMatched.add(debit.id);
          alreadyMatched.add(credit.id);

          await db
            .update(transactions)
            .set({
              type: "internal_transfer",
              categoryId: debitCategoryId,
              linkedTransactionId: credit.id,
            })
            .where(and(eq(transactions.id, debit.id), eq(transactions.userId, debit.userId)));

          await db
            .update(transactions)
            .set({
              type: "internal_transfer",
              categoryId: creditCategoryId,
              linkedTransactionId: debit.id,
            })
            .where(and(eq(transactions.id, credit.id), eq(transactions.userId, credit.userId)));

          matchedPairs++;
          break; // Move to next debit
        }
      }
    }
  }

  return { matchedPairs, totalTransactionsUpdated: matchedPairs * 2 };
}
