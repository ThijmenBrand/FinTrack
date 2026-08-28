import { db as defaultDb } from "@/db";
import { transactions, categories, accounts } from "@/db/schema";
import { eq, and, notInArray, inArray, asc, or, isNull } from "drizzle-orm";
import { writableTransactions } from "@/lib/account-access";
import { excludeSplitParents } from "@/lib/split-sql";

/**
 * The user's transfer bucket, found by its stored `kind` rather than by its
 * current spelling — so renaming "Internal Transfer" to anything you like
 * keeps transfer detection working, and marking your own category as a
 * transfer makes it eligible. Oldest row wins so the seeded category beats a
 * later one the user also marked.
 */
export async function findTransferCategory(db: typeof defaultDb, userId: string) {
  const rows = await db
    .select()
    .from(categories)
    .where(and(eq(categories.kind, "transfer"), eq(categories.userId, userId)))
    .orderBy(asc(categories.createdAt), asc(categories.id))
    .limit(1);
  return rows.at(0);
}

/**
 * Undo a transfer pairing: both legs drop back to plain income/expense by sign,
 * lose the transfer category, and are marked `transferDismissed` so the next
 * import can't re-pair them.
 *
 * Needed because `detectTransfers` pairs on amount + direction + date alone: a
 * repayment from someone else lands in the same shape as a move between your own
 * accounts (you front a €101,85 bill on one account, they pay you back on
 * another the next day), and the detector cannot tell them apart. Without this,
 * a wrong guess is only fixable by deleting the row.
 *
 * Returns the OTHER leg(s) alongside the count: undoing rewrites a row on a
 * different account, and the caller is the only one who can tell the user it
 * now needs a category of its own.
 *
 * ponytail: reverts, never deletes. An import-created mirror leg has no CSV row
 * of its own, so deleting it would move the far account's balance; leaving it as
 * plain income/expense keeps every balance where the bank has it.
 */
export async function undoTransfer(
  db: typeof defaultDb,
  txId: string,
  actorId: string,
) {
  // userId is selected, not filtered on: a leg can belong to another user via a
  // shared account, and the tenant tripwire only asks that the statement name
  // user_id at all (see assertTenantScoped).
  const [tx] = await db
    .select({
      linkedTransactionId: transactions.linkedTransactionId,
      userId: transactions.userId,
    })
    .from(transactions)
    .where(eq(transactions.id, txId));
  if (!tx) return { reverted: 0, counterparts: [] };

  // The row itself, whatever it points at, and anything pointing back at it —
  // so a half-written link still gets cleaned up from either side.
  const legs = await db
    .select({
      id: transactions.id,
      amount: transactions.amount,
      userId: transactions.userId,
      accountId: transactions.accountId,
      accountName: accounts.name,
      description: transactions.description,
    })
    .from(transactions)
    // leftJoin, not inner: the revert below must never be blocked by a missing
    // account row — the name is a label, not a condition.
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      or(
        inArray(
          transactions.id,
          [txId, tx.linkedTransactionId].filter((id): id is string => !!id),
        ),
        eq(transactions.linkedTransactionId, txId),
      ),
    );

  for (const leg of legs) {
    await db
      .update(transactions)
      .set({
        type: leg.amount >= 0 ? "income" : "expense",
        linkedTransactionId: null,
        categoryId: null,
        categorySource: null,
        transferDismissed: true,
        modifiedBy: actorId,
      })
      // Scoped by the leg's OWN user_id: a pair can span a private account and a
      // shared one, so the two legs may belong to different users.
      .where(and(eq(transactions.id, leg.id), eq(transactions.userId, leg.userId)));
  }

  // Every leg but the one the user clicked. Its account name and amount are
  // already visible on the row's "Linked to …" line, so this exposes nothing
  // the caller could not already see.
  const counterparts = legs
    .filter((leg) => leg.id !== txId)
    .map((leg) => ({
      id: leg.id,
      amount: leg.amount,
      accountId: leg.accountId,
      accountName: leg.accountName,
      description: leg.description,
    }));

  return { reverted: legs.length, counterparts };
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

  // Find all transactions not yet flagged as transfers. Reimbursements are out
  // too: the user linked that row to an expense by hand, and a repayment is the
  // one thing that looks exactly like a transfer to the amount+date heuristic —
  // without this, every import would overwrite the link with a wrong guess.
  const excludedTypes: ("internal_transfer" | "reimbursement")[] = [
    "internal_transfer",
    "reimbursement",
  ];
  // Split rows can never be a transfer leg: a parent is a pure money wrapper
  // (its real category/type live on the splits), and a child is one slice of
  // a single real-world payment, not a standalone move between accounts.
  const allTx = await db
    .select()
    .from(transactions)
    .where(
      and(
        notInArray(transactions.type, excludedTypes),
        // Rows the user explicitly un-paired with "Not a transfer". Detection
        // runs on every import commit; without this it would re-pair them and
        // wipe the categories they set on both legs.
        eq(transactions.transferDismissed, false),
        writableTransactions(userId),
        excludeSplitParents(),
        isNull(transactions.parentTransactionId),
      ),
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
