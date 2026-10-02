import { NextRequest, NextResponse } from "next/server";
import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bankAccountLinks, bankAuthStates, bankConnections } from "@/db/schema";
import { withSession } from "@/lib/auth";
import { apiError } from "@/lib/api-errors";
import { getRequestMeta, logDataEvent } from "@/lib/audit";
import { openMappingState } from "@/lib/bank-sync/status";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { JOB_PRIORITY } from "@/lib/jobs/types";
import { normalizeIban } from "@/lib/csv-utils";
import { isIsoDate, validateName } from "@/lib/validation";

const NEW_ACCOUNT_TYPES = ["checking", "savings", "joint", "credit", "other"] as const;
type NewAccountType = (typeof NEW_ACCOUNT_TYPES)[number];

interface LinkRequest {
  uid: string;
  /** An existing account of the user's… */
  accountId?: string;
  /** …or a new one. */
  newAccount?: { name: string; type: string };
  syncFrom: string;
}

/**
 * POST /api/bank-sync/links  { authStateId, links: LinkRequest[] }
 *
 * Finish a new connection by mapping its bank accounts to FinTrack accounts.
 * Only open to the session that went to the bank, within that trip's
 * lifetime, once — the auth state is what authorises it (the step-up was
 * given when the trip started). Owner-only: an account shared with you can't
 * be fed by your bank.
 */
export async function POST(request: NextRequest) {
  return withSession(async (ids) => {
    const { userId } = ids;
    const body = (await request.json().catch(() => null)) as { authStateId?: unknown; links?: unknown } | null;
    const authStateId = typeof body?.authStateId === "string" ? body.authStateId : "";
    const links = Array.isArray(body?.links) ? (body.links as LinkRequest[]) : [];
    if (!authStateId || links.length === 0 || links.length > 50) return apiError("api.bankMappingInvalid", 400);

    const state = await openMappingState(ids, authStateId);
    if (!state?.connectionId) return apiError("api.bankAuthStateInvalid", 400);
    const [connection] = await db
      .select()
      .from(bankConnections)
      .where(and(eq(bankConnections.id, state.connectionId), eq(bankConnections.userId, userId)))
      .limit(1);
    if (!connection) return apiError("api.bankAuthStateInvalid", 400);

    let available: Array<{ uid: string; iban: string | null; name: string | null; currency: string | null }>;
    try {
      available = JSON.parse(connection.availableAccounts);
    } catch {
      return apiError("api.bankMappingInvalid", 400);
    }
    const byUid = new Map(available.map((a) => [a.uid, a]));
    const today = new Date().toISOString().slice(0, 10);

    // Validate everything before writing anything.
    const seenUids = new Set<string>();
    const seenAccounts = new Set<string>();
    const existingIds = links.map((l) => l.accountId).filter((v): v is string => typeof v === "string");
    const owned = existingIds.length
      ? await db
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.userId, userId), inArray(accounts.id, existingIds)))
      : [];
    const ownedIds = new Set(owned.map((a) => a.id));
    const alreadyLinked = existingIds.length
      ? await db
          .select({ accountId: bankAccountLinks.accountId })
          .from(bankAccountLinks)
          .where(and(eq(bankAccountLinks.userId, userId), inArray(bankAccountLinks.accountId, existingIds)))
      : [];
    if (alreadyLinked.length > 0) return apiError("api.bankAccountAlreadyLinked", 409);

    const plan: Array<{ uid: string; iban: string | null; currency: string; syncFrom: string; accountId: string | null; newAccount: { name: string; type: NewAccountType } | null }> = [];
    for (const l of links) {
      const bankAccount = typeof l?.uid === "string" ? byUid.get(l.uid) : undefined;
      if (!bankAccount || seenUids.has(bankAccount.uid)) return apiError("api.bankMappingInvalid", 400);
      seenUids.add(bankAccount.uid);
      if (!isIsoDate(l.syncFrom) || l.syncFrom > today) return apiError("api.bankInvalidSyncFrom", 400);
      if (l.accountId) {
        if (!ownedIds.has(l.accountId) || seenAccounts.has(l.accountId)) return apiError("api.bankMappingInvalid", 400);
        seenAccounts.add(l.accountId);
        plan.push({ uid: bankAccount.uid, iban: normalizeIban(bankAccount.iban), currency: "EUR", syncFrom: l.syncFrom, accountId: l.accountId, newAccount: null });
      } else {
        const name = validateName(l.newAccount?.name);
        const type = l.newAccount?.type;
        if (!name.ok || !(NEW_ACCOUNT_TYPES as readonly string[]).includes(type ?? "")) {
          return apiError("api.bankMappingInvalid", 400);
        }
        const currency = /^[A-Z]{3}$/.test(bankAccount.currency ?? "") ? bankAccount.currency! : "EUR";
        plan.push({ uid: bankAccount.uid, iban: normalizeIban(bankAccount.iban), currency, syncFrom: l.syncFrom, accountId: null, newAccount: { name: name.value, type: type as NewAccountType } });
      }
    }

    const now = new Date().toISOString();
    const linkIds: string[] = [];
    await db.transaction(async (tx) => {
      const [{ total }] = await tx.select({ total: count() }).from(accounts).where(eq(accounts.userId, userId));
      let sortOrder = total;
      for (const p of plan) {
        let accountId = p.accountId;
        if (!accountId) {
          accountId = crypto.randomUUID();
          await tx.insert(accounts).values({
            id: accountId,
            userId,
            name: p.newAccount!.name,
            type: p.newAccount!.type,
            bankName: connection.aspspName.slice(0, 100),
            iban: p.iban,
            currency: p.currency,
            initialBalance: 0,
            internalTransfers: true,
            sortOrder: sortOrder++,
            createdAt: now,
            updatedAt: now,
          });
        }
        const linkId = crypto.randomUUID();
        linkIds.push(linkId);
        await tx.insert(bankAccountLinks).values({
          id: linkId,
          userId,
          accountId,
          connectionId: connection.id,
          externalUid: p.uid,
          iban: p.iban,
          syncFrom: p.syncFrom,
          createdAt: now,
          updatedAt: now,
        });
        // First sync right away, in the same transaction as the link: either
        // both exist or neither does.
        await enqueueJob(userId, "bank.sync_link", { linkId }, {
          tx,
          priority: JOB_PRIORITY.interactive,
          dedupeKey: `sync:${linkId}`,
        });
      }
      await tx
        .update(bankAuthStates)
        .set({ completedAt: now })
        .where(and(eq(bankAuthStates.id, state.id), eq(bankAuthStates.userId, userId)));
    });

    logDataEvent({
      userId,
      action: "bank_accounts_linked",
      targetId: connection.id,
      targetType: "bank_connection",
      details: { links: linkIds.length, newAccounts: plan.filter((p) => !p.accountId).length },
      ...getRequestMeta(request.headers),
    });
    return NextResponse.json({ linkIds }, { status: 201 });
  }, "Failed to link bank accounts");
}
