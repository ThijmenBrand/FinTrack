import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import { accountMembers, accounts, tags, transactionTags, transactions } from "@/db/schema";
import { activeMembership, visibleTransactions } from "@/lib/account-access";
import type { TransactionTag } from "@/types/api";

/**
 * WHERE fragment for the tags table: the user's own tags plus those of owners
 * who share an account with them. The same rule as `visibleCategories` and for
 * the same reason — a shared row carries the OWNER's tag ids, and the member
 * has to be able to resolve their names.
 */
export function visibleTags(userId: string): SQL {
  return or(
    eq(tags.userId, userId),
    inArray(
      tags.userId,
      db
        .select({ id: accounts.userId })
        .from(accountMembers)
        .innerJoin(accounts, eq(accounts.id, accountMembers.accountId))
        .where(activeMembership(userId)),
    ),
  )!;
}

/**
 * The tags on each of `transactionIds`, keyed by transaction id. One query for
 * the whole page rather than a correlated GROUP_CONCAT per row: a tag name is
 * free text, so there is no separator a concat could split back on safely.
 *
 * Joined through `transactions` and gated on `visibleTransactions`, so the
 * scope is proven here rather than assumed from where the ids came from — a
 * caller that passes an id it may not read gets nothing back for it.
 */
export async function tagsForTransactions(
  userId: string,
  transactionIds: string[],
): Promise<Map<string, TransactionTag[]>> {
  const byTransaction = new Map<string, TransactionTag[]>();
  if (!transactionIds.length) return byTransaction;

  const rows = await db
    .select({
      transactionId: transactionTags.transactionId,
      id: tags.id,
      name: tags.name,
    })
    .from(transactionTags)
    .innerJoin(tags, eq(tags.id, transactionTags.tagId))
    .innerJoin(transactions, eq(transactions.id, transactionTags.transactionId))
    .where(and(inArray(transactionTags.transactionId, transactionIds), visibleTransactions(userId)))
    // Stable badge order, and the order the picker lists them in.
    .orderBy(tags.name);

  for (const row of rows) {
    const list = byTransaction.get(row.transactionId) ?? [];
    list.push({ id: row.id, name: row.name });
    byTransaction.set(row.transactionId, list);
  }
  return byTransaction;
}

/**
 * WHERE fragment: the row carries at least one of `tagIds`.
 *
 * Correlated rather than a join, so a row with three matching tags is still
 * one row — a join would multiply it, and with it every total on the page.
 */
export function hasAnyTag(tagIds: string[]): SQL {
  return sql`EXISTS (
    SELECT 1 FROM transaction_tags tt
    WHERE tt.transaction_id = ${transactions.id}
      AND tt.user_id = "transactions"."user_id"
      AND ${inArray(sql`tt.tag_id`, tagIds)}
  )`;
}

/**
 * Same, for a split parent: it is a pure wrapper, so a tag put on one of its
 * hidden parts must still surface the family — the way a category filter does
 * (see parentHasChildInCategories).
 */
export function parentHasChildWithTags(tagIds: string[]): SQL {
  return sql`(${transactions.isSplitParent} = 1 AND EXISTS (
    SELECT 1 FROM transactions c
    JOIN transaction_tags tt ON tt.transaction_id = c.id
    WHERE c.parent_transaction_id = ${transactions.id}
      AND c.user_id = "transactions"."user_id"
      AND tt.user_id = c.user_id
      AND ${inArray(sql`tt.tag_id`, tagIds)}
  ))`;
}

/**
 * The totals counterpart: a tag put on the split PARENT — the only row of the
 * family the list shows — matches no child, and the totals sum children only
 * (the wrapper is excluded there). Without this a tag filter lists the family
 * and totals it to zero. Mirrors childHasParentMatchingSearch.
 */
export function childHasParentWithTags(tagIds: string[]): SQL {
  return sql`EXISTS (
    SELECT 1 FROM transaction_tags tt
    WHERE tt.transaction_id = ${transactions.parentTransactionId}
      AND tt.user_id = "transactions"."user_id"
      AND ${inArray(sql`tt.tag_id`, tagIds)}
  )`;
}

/**
 * Drop every tag link on `transactionIds`. Called by the paths that delete the
 * transactions themselves: `foreign_keys=ON` is not guaranteed on hosted
 * libsql, so the migration's cascade is a backstop, not the mechanism.
 *
 * Takes the handle so it can run inside the transaction doing the deleting.
 */
export async function clearTransactionTags(
  handle: typeof db | DbTx,
  transactionIds: string[],
  ownerIds: string[],
): Promise<void> {
  if (!transactionIds.length || !ownerIds.length) return;
  await handle
    .delete(transactionTags)
    .where(
      and(
        inArray(transactionTags.transactionId, transactionIds),
        inArray(transactionTags.userId, ownerIds),
      ),
    );
}

/** The same sweep for a whole import, which a rollback deletes by batch id. */
export async function clearImportBatchTags(
  handle: typeof db | DbTx,
  batchId: string,
  ownerId: string,
): Promise<void> {
  await handle.delete(transactionTags).where(
    and(
      eq(transactionTags.userId, ownerId),
      inArray(
        transactionTags.transactionId,
        handle
          .select({ id: transactions.id })
          .from(transactions)
          .where(and(eq(transactions.importBatchId, batchId), eq(transactions.userId, ownerId))),
      ),
    ),
  );
}

/**
 * The same sweep for every child of `parentId` — a re-split or an unsplit
 * deletes them all. Takes the handle so it can run inside the transaction that
 * removes the children, rather than beside it.
 */
export async function clearSplitChildTags(
  handle: typeof db | DbTx,
  parentId: string,
  ownerId: string,
): Promise<void> {
  await handle.delete(transactionTags).where(
    and(
      eq(transactionTags.userId, ownerId),
      inArray(
        transactionTags.transactionId,
        handle
          .select({ id: transactions.id })
          .from(transactions)
          .where(
            and(eq(transactions.parentTransactionId, parentId), eq(transactions.userId, ownerId)),
          ),
      ),
    ),
  );
}
