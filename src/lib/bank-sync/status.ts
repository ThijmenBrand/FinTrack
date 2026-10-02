import { and, desc, eq, gt, inArray, isNotNull, isNull, max, sum } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  bankAccountLinks,
  bankAuthStates,
  bankConnections,
  bankCredentials,
  jobs,
  transactions,
} from "@/db/schema";
import { lastHeartbeat } from "@/db/jobs";
import { excludeSplitChildren } from "@/lib/split-sql";
import type { SessionIds } from "@/lib/auth";
import { WORKER_STALE_MS, bankSyncRedirectUrl } from "./config";

/**
 * Everything the bank-connections screen shows, in one read. Never includes
 * anything secret: no key, no session id, no auth state — the certificate is
 * public by design.
 */

export interface MappingAccount {
  uid: string;
  iban: string | null;
  name: string | null;
  currency: string | null;
  /** The user's account with this IBAN, if there is one. */
  suggestedAccountId: string | null;
  /** The day after the newest row already in that account (or 90 days back). */
  suggestedSyncFrom: string;
  /** Already linked (to `linkedAccountId`) — shown, not offered again. */
  linkedAccountId: string | null;
}

export interface BankSyncStatus {
  workerOnline: boolean;
  redirectUrl: string;
  credential: null | {
    id: string;
    status: "pending_app_id" | "verifying" | "verified" | "invalid";
    appId: string | null;
    certificatePem: string;
    fingerprint: string;
    notAfter: string;
    lastErrorCode: string | null;
    verifiedAt: string | null;
  };
  /** A credential job (generate/verify/delete) still in the queue. */
  pendingCredentialJob: string | null;
  connections: Array<{
    id: string;
    aspspName: string;
    aspspCountry: string;
    status: "active" | "expired" | "revoked" | "error";
    validUntil: string | null;
    lastErrorCode: string | null;
    disconnecting: boolean;
    links: Array<{
      id: string;
      accountId: string;
      accountName: string;
      iban: string | null;
      syncFrom: string;
      lastSyncedAt: string | null;
      lastErrorCode: string | null;
      bankBalance: number | null;
      bankBalanceAt: string | null;
      fintrackBalance: number;
      syncing: boolean;
    }>;
  }>;
  /** A connect flow of THIS session waiting for its account mapping. */
  pendingMapping: null | {
    authStateId: string;
    connectionId: string;
    aspspName: string;
    expiresAt: string;
    accounts: MappingAccount[];
  };
}

const iso = (ms: number) => new Date(ms).toISOString();

export async function bankSyncStatus(ids: SessionIds): Promise<BankSyncStatus> {
  const { userId } = ids;
  const beat = await lastHeartbeat();

  const [credential] = await db
    .select()
    .from(bankCredentials)
    .where(eq(bankCredentials.userId, userId))
    .limit(1);

  const active = await db
    .select({ id: jobs.id, type: jobs.type, payload: jobs.payload })
    .from(jobs)
    .where(and(eq(jobs.userId, userId), inArray(jobs.status, ["queued", "running"])));
  const pendingCredentialJob =
    active.find((j) =>
      ["bank.generate_credential", "bank.verify_credential", "bank.delete_credential"].includes(j.type),
    )?.id ?? null;
  const payloadField = (payload: string, key: string) => {
    try {
      return (JSON.parse(payload) as Record<string, unknown>)[key];
    } catch {
      return undefined;
    }
  };
  const syncingLinks = new Set(
    active.filter((j) => j.type === "bank.sync_link").map((j) => payloadField(j.payload, "linkId")),
  );
  const revoking = new Set(
    active.filter((j) => j.type === "bank.revoke_session").map((j) => payloadField(j.payload, "connectionId")),
  );

  const connectionRows = await db
    .select()
    .from(bankConnections)
    .where(eq(bankConnections.userId, userId))
    .orderBy(bankConnections.createdAt);
  const linkRows = await db
    .select({
      link: bankAccountLinks,
      accountName: accounts.name,
      initialBalance: accounts.initialBalance,
    })
    .from(bankAccountLinks)
    .innerJoin(accounts, and(eq(accounts.id, bankAccountLinks.accountId), eq(accounts.userId, userId)))
    .where(eq(bankAccountLinks.userId, userId));

  const linkedAccountIds = linkRows.map((r) => r.link.accountId);
  const totals = linkedAccountIds.length
    ? await db
        .select({ accountId: transactions.accountId, total: sum(transactions.amount) })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            inArray(transactions.accountId, linkedAccountIds),
            excludeSplitChildren(),
          ),
        )
        .groupBy(transactions.accountId)
    : [];
  const totalByAccount = new Map(totals.map((t) => [t.accountId, Number(t.total) || 0]));

  const connections: BankSyncStatus["connections"] = connectionRows.map((c) => ({
    id: c.id,
    aspspName: c.aspspName,
    aspspCountry: c.aspspCountry,
    status: c.status,
    validUntil: c.validUntil,
    lastErrorCode: c.lastErrorCode,
    disconnecting: revoking.has(c.id),
    links: linkRows
      .filter((r) => r.link.connectionId === c.id)
      .map(({ link, accountName, initialBalance }) => ({
        id: link.id,
        accountId: link.accountId,
        accountName,
        iban: link.iban,
        syncFrom: link.syncFrom,
        lastSyncedAt: link.lastSyncedAt,
        lastErrorCode: link.lastErrorCode,
        bankBalance: link.bankBalance,
        bankBalanceAt: link.bankBalanceAt,
        fintrackBalance: Math.round((initialBalance + (totalByAccount.get(link.accountId) ?? 0)) * 100) / 100,
        syncing: syncingLinks.has(link.id),
      })),
  }));

  return {
    workerOnline: !!beat && Date.now() - Date.parse(beat) < WORKER_STALE_MS,
    redirectUrl: bankSyncRedirectUrl(),
    credential: credential
      ? {
          id: credential.id,
          status: credential.status,
          appId: credential.appId,
          certificatePem: credential.certificatePem,
          fingerprint: credential.certificateFingerprint,
          notAfter: credential.certificateNotAfter,
          lastErrorCode: credential.lastErrorCode,
          verifiedAt: credential.verifiedAt,
        }
      : null,
    pendingCredentialJob,
    connections,
    pendingMapping: await pendingMapping(ids, linkRows.map((r) => r.link)),
  };
}

/**
 * The mapping screen is only ever open for a connection this very session
 * created, within the auth state's lifetime, and only until it is saved.
 */
export async function openMappingState(ids: SessionIds, authStateId?: string) {
  const [state] = await db
    .select()
    .from(bankAuthStates)
    .where(
      and(
        eq(bankAuthStates.userId, ids.userId),
        eq(bankAuthStates.sessionId, ids.sessionId),
        eq(bankAuthStates.purpose, "connect"),
        isNotNull(bankAuthStates.usedAt),
        isNull(bankAuthStates.completedAt),
        isNotNull(bankAuthStates.connectionId),
        gt(bankAuthStates.expiresAt, iso(Date.now())),
        authStateId ? eq(bankAuthStates.id, authStateId) : undefined,
      ),
    )
    .orderBy(desc(bankAuthStates.createdAt))
    .limit(1);
  return state ?? null;
}

async function pendingMapping(
  ids: SessionIds,
  links: Array<{ accountId: string; iban: string | null; externalUid: string; connectionId: string }>,
): Promise<BankSyncStatus["pendingMapping"]> {
  const state = await openMappingState(ids);
  if (!state?.connectionId) return null;
  const [connection] = await db
    .select()
    .from(bankConnections)
    .where(and(eq(bankConnections.id, state.connectionId), eq(bankConnections.userId, ids.userId)))
    .limit(1);
  if (!connection) return null;

  let available: Array<{ uid: string; iban: string | null; name: string | null; currency: string | null }>;
  try {
    available = JSON.parse(connection.availableAccounts);
  } catch {
    available = [];
  }
  const own = await db
    .select({ id: accounts.id, iban: accounts.iban })
    .from(accounts)
    .where(eq(accounts.userId, ids.userId));
  const latest = await latestDates(own.map((a) => a.id), ids.userId);
  const normalize = (v: string | null) => v?.replace(/\s/g, "").toUpperCase() || null;

  return {
    authStateId: state.id,
    connectionId: connection.id,
    aspspName: connection.aspspName,
    expiresAt: state.expiresAt,
    accounts: available.map((a) => {
      const match = a.iban ? own.find((o) => normalize(o.iban) === normalize(a.iban)) : undefined;
      const linked = links.find((l) => l.connectionId === connection.id && l.externalUid === a.uid);
      return {
        uid: a.uid,
        iban: a.iban,
        name: a.name,
        currency: a.currency,
        suggestedAccountId: match?.id ?? null,
        suggestedSyncFrom: defaultSyncFrom(match ? latest.get(match.id) : undefined),
        linkedAccountId: linked?.accountId ?? null,
      };
    }),
  };
}

/** Newest transaction date per account. */
export async function latestDates(accountIds: string[], userId: string): Promise<Map<string, string>> {
  if (accountIds.length === 0) return new Map();
  const rows = await db
    .select({ accountId: transactions.accountId, date: max(transactions.date) })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), inArray(transactions.accountId, accountIds)))
    .groupBy(transactions.accountId);
  return new Map(rows.filter((r) => r.date).map((r) => [r.accountId, r.date!]));
}

/**
 * Where a new link starts: the day after the newest row already in the
 * account — so CSV history is never imported twice — or, for an empty
 * account, 90 days back (what banks typically hand out without a fresh SCA).
 */
export function defaultSyncFrom(latest: string | undefined, now = Date.now()): string {
  if (latest) {
    const next = new Date(Date.parse(`${latest.slice(0, 10)}T00:00:00Z`) + 86_400_000);
    return next.toISOString().slice(0, 10);
  }
  return new Date(now - 90 * 86_400_000).toISOString().slice(0, 10);
}
