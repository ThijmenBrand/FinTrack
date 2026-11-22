/**
 * Reading and writing an investment account's valuation history.
 *
 * `assetValuations` is the record; `accounts.currentValue` / `accounts.valuedAt`
 * are a materialized copy of its newest row, so the many reads that only want
 * today's figure stay one query. That copy is derived, never authored — every
 * write goes through `recordValuation` or `deleteValuation` here, and both end
 * by rewriting the pair from the history. Nothing else should set those two
 * columns.
 *
 * Series work is in @/lib/investment-series; this module only owns the rows.
 */
import { db as defaultDb } from "@/db";
import { accounts, assetValuations } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";

export type ValuationSource = "manual" | "import" | "price";

export interface Valuation {
  id: string;
  date: string;
  value: number;
  source: ValuationSource;
  createdAt: string;
}

/**
 * Rewrite `accounts.currentValue` / `valuedAt` from the newest row in the
 * history. Called after every write; safe to call when nothing changed.
 *
 * An account whose last valuation was just deleted goes back to null — not to
 * zero, and not to a stale figure that would outlive the row it came from.
 */
export async function syncLatestValuation(
  db: typeof defaultDb,
  ownerId: string,
  accountId: string,
): Promise<{ value: number | null; date: string | null }> {
  const [latest] = await db
    .select({ value: assetValuations.value, date: assetValuations.date })
    .from(assetValuations)
    .where(
      and(
        eq(assetValuations.userId, ownerId),
        eq(assetValuations.accountId, accountId),
      ),
    )
    // Same-day corrections share a date, so createdAt breaks the tie: the row
    // written last is the one that meant to win.
    .orderBy(desc(assetValuations.date), desc(assetValuations.createdAt))
    .limit(1);

  const next = { value: latest?.value ?? null, date: latest?.date ?? null };
  await db
    .update(accounts)
    .set({
      currentValue: next.value,
      valuedAt: next.date,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, ownerId)));
  return next;
}

/**
 * Record what an account was worth on a date. A second figure for the same
 * date replaces the first: two values for one day would make the series
 * ambiguous, and in practice a repeat entry is a correction.
 *
 * `ownerId` is the ACCOUNT OWNER, not whoever is typing — a shared account's
 * rows all live in the owner's space, like its transactions.
 */
export async function recordValuation(
  db: typeof defaultDb,
  opts: {
    ownerId: string;
    accountId: string;
    date: string;
    value: number;
    source?: ValuationSource;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(assetValuations)
    .values({
      userId: opts.ownerId,
      accountId: opts.accountId,
      date: opts.date,
      value: opts.value,
      source: opts.source ?? "manual",
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [assetValuations.accountId, assetValuations.date],
      set: { value: opts.value, source: opts.source ?? "manual", createdAt: now },
    });
  await syncLatestValuation(db, opts.ownerId, opts.accountId);
}

/** Remove one dated figure — a typo, or a day that should never have had one. */
export async function deleteValuation(
  db: typeof defaultDb,
  ownerId: string,
  accountId: string,
  valuationId: string,
): Promise<boolean> {
  const scope = and(
    eq(assetValuations.userId, ownerId),
    eq(assetValuations.accountId, accountId),
    eq(assetValuations.id, valuationId),
  );
  const [existing] = await db
    .select({ id: assetValuations.id })
    .from(assetValuations)
    .where(scope);
  if (!existing) return false;

  await db.delete(assetValuations).where(scope);
  await syncLatestValuation(db, ownerId, accountId);
  return true;
}

/**
 * Drop an account's whole history.
 *
 * This is what "clear the value" means once there is a record: leaving the
 * rows behind would let a cleared figure reappear the moment the account
 * became an investment one again. Only reached deliberately — by clearing the
 * value through the API, or by changing the account's type away from
 * investment — never as a side effect of an ordinary edit.
 */
export async function clearValuations(
  db: typeof defaultDb,
  ownerId: string,
  accountId: string,
): Promise<void> {
  await db
    .delete(assetValuations)
    .where(
      and(
        eq(assetValuations.userId, ownerId),
        eq(assetValuations.accountId, accountId),
      ),
    );
  await syncLatestValuation(db, ownerId, accountId);
}

/** One account's history, newest first. */
export async function listValuations(
  db: typeof defaultDb,
  ownerId: string,
  accountId: string,
  limit = 100,
): Promise<Valuation[]> {
  const rows = await db
    .select({
      id: assetValuations.id,
      date: assetValuations.date,
      value: assetValuations.value,
      source: assetValuations.source,
      createdAt: assetValuations.createdAt,
    })
    .from(assetValuations)
    .where(
      and(
        eq(assetValuations.userId, ownerId),
        eq(assetValuations.accountId, accountId),
      ),
    )
    .orderBy(desc(assetValuations.date), desc(assetValuations.createdAt))
    .limit(limit);
  return rows;
}
