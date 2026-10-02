import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  bankAccountLinks,
  bankConnections,
  bankCredentials,
} from "@/db/schema";
import { classifyRows } from "@/lib/import/classify";
import { commitImport, type CommitTransaction } from "@/lib/import/commit";
import { SYNC_OVERLAP_DAYS } from "@/lib/bank-sync/config";
import { logDataEvent } from "@/lib/audit";
import { clientFor, loadConnection, loadCredential } from "../bank-sync/context";
import { normalizeTransactions, pickBalance } from "../bank-sync/normalize";
import { JobError } from "../errors";
import type { EbTransaction } from "../enable-banking/validate";
import { payloadString, type Handler } from "./types";

/** Never page through more than this per run; the rest comes next sync. */
const MAX_PAGES = 50;

const shiftDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * One sync of one linked account:
 *  1. fetch booked transactions from (last booking − 5 days), all pages
 *  2. validate + normalise (untrusted input), stable external ids
 *  3. drop ids already present, classify exactly like a CSV import
 *  4. commit in ONE transaction together with the cursor — a crash or a
 *     retry can never leave half a sync or skip rows
 *  5. read the bank's balance for the reconciliation check
 *
 * Only the account owner's links exist (the link API is owner-only), and the
 * sync acts as the owner.
 */
export const syncLinkHandler: Handler<"bank.sync_link"> = async (payload, ctx) => {
  const linkId = payloadString(payload, "linkId");
  const psu = payload.psu;

  const [link] = await db
    .select()
    .from(bankAccountLinks)
    .where(and(eq(bankAccountLinks.id, linkId), eq(bankAccountLinks.userId, ctx.userId)))
    .limit(1);
  // Disconnected since the job was queued: nothing to do.
  if (!link) return { skipped: "link_gone" };

  const connection = await loadConnection(ctx.userId, link.connectionId);
  if (connection.status !== "active") return { skipped: "connection_inactive" };

  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, link.accountId), eq(accounts.userId, ctx.userId)))
    .limit(1);
  if (!account) {
    // The account was deleted but its link survived (FK cascade not
    // enforced): drop the link so the scheduler stops queueing it.
    await db
      .delete(bankAccountLinks)
      .where(and(eq(bankAccountLinks.id, link.id), eq(bankAccountLinks.userId, ctx.userId)));
    return { skipped: "account_gone" };
  }

  const markLink = (code: string | null) =>
    db
      .update(bankAccountLinks)
      .set({ lastErrorCode: code, updatedAt: new Date().toISOString() })
      .where(and(eq(bankAccountLinks.id, link.id), eq(bankAccountLinks.userId, ctx.userId)));

  try {
    const credential = await loadCredential(ctx.userId, { requireVerified: true });
    const client = clientFor(credential);

    const dateFrom = link.lastBookedDate
      ? maxDate(link.syncFrom, shiftDays(link.lastBookedDate, -SYNC_OVERLAP_DAYS))
      : link.syncFrom;

    const raw: EbTransaction[] = [];
    let continuationKey: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await client.getTransactions(link.externalUid, { dateFrom, continuationKey }, psu);
      raw.push(...result.transactions);
      continuationKey = result.continuationKey;
      // An empty page can still carry a key — only a missing key ends it.
      if (!continuationKey) break;
      await ctx.keepAlive();
    }

    const { rows, skipped } = normalizeTransactions(raw, account.currency);
    // Never import before the agreed start, whatever the bank sends back.
    const inRange = rows.filter((r) => r.date >= link.syncFrom);
    const newest = inRange.reduce<string | null>((max, r) => (!max || r.date > max ? r.date : max), link.lastBookedDate);

    const balances = await client.getBalances(link.externalUid, psu).catch((err) => {
      // The balance is a check, not the payload: don't fail a sync over it,
      // but don't swallow a dead consent either.
      if (err instanceof JobError && err.kind === "user_action") throw err;
      return [];
    });
    const bankBalance = pickBalance(balances, account.currency);

    const classified = await classifyRows(account, inRange);
    const toCommit: CommitTransaction[] = classified.map((tx, i) => ({
      tempId: tx.tempId,
      date: tx.date,
      name: tx.name,
      description: tx.description,
      amount: tx.amount,
      balance: tx.balance,
      type: tx.type,
      categoryId: tx.categoryId,
      counterpartyIban: tx.counterpartyIban ?? null,
      targetAccountId: tx.targetAccountId,
      recurringTransactionId: tx.recurringTransactionId ?? null,
      splits: tx.splits ?? null,
      splitRuleId: tx.splitRuleId ?? null,
      externalId: inRange[i].externalId,
    }));

    const now = new Date().toISOString();
    const result = await commitImport({
      actorId: ctx.userId,
      account,
      batchLabel: `Bank sync · ${connection.aspspName}`.slice(0, 200),
      source: "bank_sync",
      transactions: toCommit,
      dedupe: "externalId",
      afterWrite: async (tx) => {
        await tx
          .update(bankAccountLinks)
          .set({
            lastBookedDate: newest,
            lastSyncedAt: now,
            lastErrorCode: null,
            ...(bankBalance !== null ? { bankBalance, bankBalanceAt: now } : {}),
            updatedAt: now,
          })
          .where(and(eq(bankAccountLinks.id, link.id), eq(bankAccountLinks.userId, ctx.userId)));
      },
    });
    if (!result.ok) {
      // Classified rows failing commit validation means our own pipeline
      // disagrees with itself — a bug, not the user's problem.
      throw new JobError("bug", "internal", `Sync rows failed validation (${result.error})`);
    }

    logDataEvent({
      userId: ctx.userId,
      action: "bank_sync_run",
      targetId: link.id,
      targetType: "bank_account_link",
      details: {
        accountId: account.id,
        fetched: raw.length,
        imported: result.imported,
        duplicates: result.duplicatesSkipped,
        mirrorsAbsorbed: result.mirrorsAbsorbed,
        skippedPending: skipped.pending,
        skippedCurrency: skipped.currency,
        skippedInvalid: skipped.invalid,
        attended: !!psu,
      },
    });
    return { imported: result.imported, duplicates: result.duplicatesSkipped };
  } catch (err) {
    await recordFailure(ctx.userId, connection.id, connection.credentialId, err, markLink);
    throw err;
  }
};

function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

/** Put the failure where the user will see it: on the link, connection or credential. */
async function recordFailure(
  userId: string,
  connectionId: string,
  credentialId: string,
  err: unknown,
  markLink: (code: string | null) => Promise<unknown>,
) {
  if (!(err instanceof JobError)) {
    await markLink("internal");
    return;
  }
  await markLink(err.code);
  if (err.kind !== "user_action") return;
  const now = new Date().toISOString();
  if (err.code === "consent_expired" || err.code === "consent_revoked") {
    await db
      .update(bankConnections)
      .set({
        status: err.code === "consent_expired" ? "expired" : "revoked",
        lastErrorCode: err.code,
        updatedAt: now,
      })
      .where(and(eq(bankConnections.id, connectionId), eq(bankConnections.userId, userId)));
  } else if (err.code === "key_rejected" || err.code === "certificate_expired" || err.code === "app_not_found") {
    await db
      .update(bankCredentials)
      .set({ status: "invalid", lastErrorCode: err.code, updatedAt: now })
      .where(and(eq(bankCredentials.id, credentialId), eq(bankCredentials.userId, userId)));
  }
}
