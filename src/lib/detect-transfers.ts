import { db as defaultDb } from "@/db";
import { transactions, categories, accounts } from "@/db/schema";
import { eq, and, notInArray, inArray, asc, or, isNull, sql } from "drizzle-orm";
import { visibleAccounts, writableTransactions } from "@/lib/account-access";
import { normalizeIban } from "@/lib/csv-utils";
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
 * Split every transfer pair that touches `accountId` back into two ordinary
 * transactions. Run when an account stops holding money that is purely yours
 * (`internalTransfers` switched off): everything the detector already paired
 * has to follow the new policy, not just what arrives next.
 *
 * Unlike `undoTransfer` this does NOT set `transferDismissed`. That flag records
 * a judgement about one specific row ("this particular pair was wrong"); here
 * the account's policy is what keeps the legs apart, and it holds for rows that
 * do not exist yet. Switching the flag back on should re-pair them.
 *
 * Both legs come out uncategorized, so the normal category rules can claim them
 * on the next recalculation — a contribution to a joint account genuinely wants
 * a category on each side, and the transfer bucket is not it.
 *
 * Import-created mirror legs sitting ON this account are deleted rather than
 * reverted. A mirror is money the *other* bank reported, written into this
 * account because the import assumed both sides were yours. Once they are not,
 * this account's own export is the only honest source for it, and a surviving
 * mirror would double-count the moment that export is imported.
 *
 * ponytail: an account whose CSV is never imported loses those rows from its
 * balance. Acceptable — it holds money that isn't yours to track. Revisit if
 * anyone wants a joint account they only ever see through the other side.
 */
export async function splitTransfersForAccount(
  db: typeof defaultDb,
  accountId: string,
  actorId: string,
) {
  const legs = await db
    .select({
      id: transactions.id,
      userId: transactions.userId,
      linkedTransactionId: transactions.linkedTransactionId,
      isMirror: transactions.isMirror,
    })
    .from(transactions)
    .where(
      and(eq(transactions.accountId, accountId), eq(transactions.type, "internal_transfer")),
    );
  if (legs.length === 0) return { split: 0, removedMirrors: 0 };

  // The far legs live on other accounts (and, on a shared account, can belong
  // to another user), so they are collected by id rather than by account.
  const counterpartIds = legs
    .map((leg) => leg.linkedTransactionId)
    .filter((id): id is string => !!id);
  const counterparts = counterpartIds.length
    ? await db
        .select({ id: transactions.id, userId: transactions.userId })
        .from(transactions)
        .where(inArray(transactions.id, counterpartIds))
    : [];

  // What the import writes into the far account and nothing else, by its own
  // flag. Never inferred from shape: a hand-entered row looks identical to a
  // mirror once the detector pairs it, and deleting one loses real money.
  const mirrors = legs.filter((leg) => leg.isMirror && leg.linkedTransactionId);
  if (mirrors.length) {
    await db.delete(transactions).where(
      and(
        inArray(transactions.id, mirrors.map((leg) => leg.id)),
        inArray(transactions.userId, [...new Set(mirrors.map((leg) => leg.userId))]),
      ),
    );
  }

  const mirrorIds = new Set(mirrors.map((leg) => leg.id));
  const all = [...legs.filter((leg) => !mirrorIds.has(leg.id)), ...counterparts];
  if (all.length === 0) return { split: legs.length, removedMirrors: mirrors.length };

  await db
    .update(transactions)
    .set({
      // In SQL so every leg reverts in one statement, whichever way it points.
      type: sql`CASE WHEN ${transactions.amount} >= 0 THEN 'income' ELSE 'expense' END`,
      linkedTransactionId: null,
      categoryId: null,
      categorySource: null,
      modifiedBy: actorId,
    })
    .where(
      and(
        inArray(transactions.id, all.map((leg) => leg.id)),
        inArray(transactions.userId, [...new Set(all.map((leg) => leg.userId))]),
      ),
    );

  return { split: legs.length, removedMirrors: mirrors.length };
}

/** What pairing needs to know about an account. */
export type TransferAccount = {
  iban: string | null;
  internalTransfers: boolean;
};

/** One leg, reduced to the fields that decide whether it pairs. */
export type TransferLeg = {
  accountId: string;
  date: string;
  counterpartyIban: string | null;
};

/** Days either leg may lag the other and still be the same money. */
export const TRANSFER_WINDOW_DAYS = 2;

/**
 * Whether two dates are close enough for the legs to be one payment. Banks book
 * the two sides of a move on different days, and a weekend can push them apart.
 */
export function withinTransferWindow(a: string, b: string): boolean {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= TRANSFER_WINDOW_DAYS * 86_400_000;
}

/**
 * Whether two opposite, equal-amount legs are the same money moving between
 * two of your own accounts.
 *
 * Three gates, in order of how much they actually prove:
 *
 * 1. **Account policy.** Either account with `internalTransfers` off means the
 *    money changed hands — a contribution to a joint household account is a
 *    real expense on one side and a real income on the other, and the pair must
 *    stay two ordinary transactions.
 * 2. **IBAN.** When a leg recorded a counterparty IBAN *and* the other account
 *    has one registered, they must agree. A mismatch is proof the legs are
 *    unrelated, so it rejects outright — this is what stops a friend repaying
 *    you €101,85 from being swallowed as a transfer. Unverifiable (no
 *    counterparty IBAN on the export, or no IBAN on the account) falls through.
 * 3. **Date proximity.** The original heuristic, and all that is left when
 *    neither side carries an IBAN.
 */
export function isTransferPair(
  debit: TransferLeg,
  credit: TransferLeg,
  accountById: Map<string, TransferAccount>,
): boolean {
  if (debit.accountId === credit.accountId) return false;

  const debitAccount = accountById.get(debit.accountId);
  const creditAccount = accountById.get(credit.accountId);
  if (!debitAccount || !creditAccount) return false;
  if (!debitAccount.internalTransfers || !creditAccount.internalTransfers) return false;

  // Each direction is checked independently: one bank exporting the IBAN is
  // enough to settle the pair, and the other exporting nothing must not veto it.
  for (const [leg, otherAccount] of [
    [debit, creditAccount],
    [credit, debitAccount],
  ] as const) {
    const claimed = normalizeIban(leg.counterpartyIban);
    const registered = normalizeIban(otherAccount.iban);
    if (claimed && registered && claimed !== registered) return false;
  }

  return withinTransferWindow(debit.date, credit.date);
}

/**
 * Detects internal transfers between accounts: money leaving account A and
 * entering account B for the same amount, close in time, where both accounts
 * hold money that is still yours. See `isTransferPair` for the rules.
 *
 * Scope is every transaction `userId` may WRITE — own rows plus rows on
 * accounts shared with them as editor — so a move between a private account
 * and a joint account gets paired from either side. Viewer-shared accounts
 * stay out: flagging only one leg of a pair is worse than flagging neither.
 */
export async function detectTransfers(db: typeof defaultDb, userId: string) {
  // Pairing policy lives on the account, so every candidate needs its two
  // accounts to hand. One query — the set is tiny next to the transactions.
  const accountRows = await db
    .select({
      id: accounts.id,
      iban: accounts.iban,
      internalTransfers: accounts.internalTransfers,
      userId: accounts.userId,
    })
    .from(accounts)
    .where(visibleAccounts(userId));
  const accountById = new Map<string, TransferAccount>(
    accountRows.map((a) => [a.id, { iban: a.iban, internalTransfers: a.internalTransfers }]),
  );

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

        if (isTransferPair(debit, credit, accountById)) {
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
