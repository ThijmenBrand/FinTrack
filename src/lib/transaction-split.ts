import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { db } from "@/db";
import { transactions, reimbursementLinks, categories } from "@/db/schema";
import { MONEY_EPSILON, isFiniteNumber, sanitizeNote } from "@/lib/validation";
import type { MessageKey } from "@/lib/i18n/translate";

export interface SplitInput {
  amount: number;
  categoryId?: string | null;
  description?: string | null;
  notes?: string | null;
}

export type SplitFailure = { ok: false; error: MessageKey; status: number };
export type SplitResult = { ok: true; childIds: string[] } | SplitFailure;

const fail = (error: MessageKey, status: number): SplitFailure => ({
  ok: false,
  error,
  status,
});

/**
 * `count` created_at stamps, one millisecond apart, so a split's children sort
 * back in the order they were written. Every insert path that writes children
 * in a loop must use these rather than the column default — see applySplit.
 */
export function splitStamps(count: number): string[] {
  const base = Date.now();
  return Array.from({ length: count }, (_, i) => new Date(base + i).toISOString());
}

/**
 * Split (or re-split) a transaction into child rows. The parent becomes a pure
 * wrapper: category cleared, `isSplitParent` set, amount untouched. Children
 * inherit the parent's account/date/name/type (and recurring link, so a split
 * mortgage stays excluded from `spentThisMonth` exactly like the unsplit row
 * was). Re-splitting replaces the existing children.
 *
 * Callers must have resolved write access already; `ownerId` is the account
 * owner whose user_id every row keeps (shared-accounts model), `actorId` the
 * acting user for created_by/modified_by.
 */
export async function applySplit(opts: {
  parentId: string;
  ownerId: string;
  actorId: string;
  splits: SplitInput[];
  source: "manual" | "rule";
}): Promise<SplitResult> {
  const { parentId, ownerId, actorId, splits, source } = opts;

  const [parent] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, parentId), eq(transactions.userId, ownerId)));
  if (!parent) return fail("api.transactionNotFound", 404);

  if (parent.parentTransactionId) return fail("api.splitNested", 400);
  if (parent.type !== "income" && parent.type !== "expense") {
    return fail("api.splitWrongType", 400);
  }
  if (parent.groupId) return fail("api.splitParentInPot", 409);

  const [reimbLink] = await db
    .select({ id: reimbursementLinks.id })
    .from(reimbursementLinks)
    .where(
      or(
        eq(reimbursementLinks.expenseId, parentId),
        eq(reimbursementLinks.reimbursementId, parentId),
      ),
    )
    .limit(1);
  if (reimbLink || parent.reimbursesTransactionId) {
    return fail("api.splitParentReimbursed", 409);
  }

  if (splits.length < 2) return fail("api.splitTooFew", 400);
  if (splits.length > 20) return fail("api.splitTooMany", 400);

  const sign = parent.amount < 0 ? -1 : 1;
  let sum = 0;
  for (const s of splits) {
    if (!isFiniteNumber(s.amount) || s.amount === 0 || Math.sign(s.amount) !== sign) {
      return fail("api.splitInvalidAmount", 400);
    }
    sum += s.amount;
  }
  if (Math.abs(sum - parent.amount) > MONEY_EPSILON) {
    return fail("api.splitSumMismatch", 400);
  }

  const categoryIds = [
    ...new Set(splits.map((s) => s.categoryId).filter((v): v is string => !!v)),
  ];
  if (categoryIds.length) {
    const owned = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(inArray(categories.id, categoryIds), eq(categories.userId, ownerId)));
    if (owned.length !== categoryIds.length) {
      return fail("api.splitInvalidCategory", 400);
    }
  }

  const linkGuard = parent.isSplitParent
    ? await childrenWithLinks(parentId, ownerId)
    : false;
  if (linkGuard) return fail("api.splitChildLinked", 409);

  const childIds: string[] = [];
  // One stamp per part, a millisecond apart. The default createdAt would give
  // every child of a split the SAME millisecond, and the list orders by
  // (created_at, id) with a random uuid as the tiebreak — so the parts came
  // back shuffled. Order is load-bearing: the editor's last row becomes a
  // split rule's remainder line.
  const stampedAt = splitStamps(splits.length);
  await db.transaction(async (tx) => {
    if (parent.isSplitParent) {
      await tx
        .delete(transactions)
        .where(and(eq(transactions.parentTransactionId, parentId), eq(transactions.userId, ownerId)));
    }
    for (const [i, s] of splits.entries()) {
      const id = crypto.randomUUID();
      childIds.push(id);
      await tx.insert(transactions).values({
        id,
        userId: ownerId,
        accountId: parent.accountId,
        date: parent.date,
        name: parent.name,
        description: s.description?.trim() || parent.description,
        amount: s.amount,
        balance: null,
        categoryId: s.categoryId ?? null,
        categorySource: s.categoryId ? source : null,
        type: parent.type,
        notes: sanitizeNote(s.notes),
        createdBy: actorId,
        isManual: parent.isManual,
        importBatchId: parent.importBatchId,
        recurringTransactionId: parent.recurringTransactionId,
        parentTransactionId: parentId,
        createdAt: stampedAt[i],
      });
    }
    await tx
      .update(transactions)
      .set({
        isSplitParent: true,
        categoryId: null,
        categorySource: null,
        categoryLabel: null,
        modifiedBy: actorId,
      })
      .where(and(eq(transactions.id, parentId), eq(transactions.userId, ownerId)));
  });

  return { ok: true, childIds };
}

/**
 * Remove a transaction's splits and restore it to a normal (uncategorized)
 * transaction. Refused while any child is in a pot or reimbursement-linked.
 */
export async function unsplitTransaction(opts: {
  parentId: string;
  ownerId: string;
  actorId: string;
}): Promise<{ ok: true } | SplitFailure> {
  const { parentId, ownerId, actorId } = opts;

  const [parent] = await db
    .select({ id: transactions.id, isSplitParent: transactions.isSplitParent })
    .from(transactions)
    .where(and(eq(transactions.id, parentId), eq(transactions.userId, ownerId)));
  if (!parent) return fail("api.transactionNotFound", 404);
  if (!parent.isSplitParent) return fail("api.splitNotSplit", 400);

  if (await childrenWithLinks(parentId, ownerId)) return fail("api.splitChildLinked", 409);

  await db.transaction(async (tx) => {
    await tx
      .delete(transactions)
      .where(and(eq(transactions.parentTransactionId, parentId), eq(transactions.userId, ownerId)));
    await tx
      .update(transactions)
      .set({ isSplitParent: false, modifiedBy: actorId })
      .where(and(eq(transactions.id, parentId), eq(transactions.userId, ownerId)));
  });

  return { ok: true };
}

/** True if any child of `parentId` is in a pot or reimbursement-linked. */
async function childrenWithLinks(parentId: string, ownerId: string): Promise<boolean> {
  const [potChild] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.parentTransactionId, parentId),
        eq(transactions.userId, ownerId),
        isNotNull(transactions.groupId),
      ),
    )
    .limit(1);
  if (potChild) return true;

  const [linkedChild] = await db
    .select({ id: reimbursementLinks.id })
    .from(reimbursementLinks)
    .innerJoin(
      transactions,
      or(
        eq(reimbursementLinks.expenseId, transactions.id),
        eq(reimbursementLinks.reimbursementId, transactions.id),
      ),
    )
    .where(and(eq(transactions.parentTransactionId, parentId), eq(transactions.userId, ownerId)))
    .limit(1);
  return !!linkedChild;
}
