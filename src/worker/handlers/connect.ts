import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  bankAccountLinks,
  bankAspspCache,
  bankAuthStates,
  bankConnections,
} from "@/db/schema";
import {
  AUTH_STATE_TTL_MS,
  MAX_CONSENT_DAYS,
  bankSyncRedirectUrl,
  isBankSyncCountry,
} from "@/lib/bank-sync/config";
import { normalizeIban } from "@/lib/csv-utils";
import { logDataEvent } from "@/lib/audit";
import { notifyBankEvent } from "@/lib/bank-sync/notify";
import { clientFor, loadConnection, loadCredential, sealSessionId, sessionIdOf } from "../bank-sync/context";
import { JobError, bug, userAction } from "../errors";
import type { EbAspsp, EbSessionAccount } from "../enable-banking/validate";
import { optionalPayloadString, payloadString, type Handler } from "./types";

const ASPSP_CACHE_MS = 24 * 3_600_000;

export interface AspspOption {
  name: string;
  country: string;
  maxConsentDays: number | null;
}

async function cachedAspsps(country: string): Promise<EbAspsp[] | null> {
  const [row] = await db.select().from(bankAspspCache).where(eq(bankAspspCache.country, country)).limit(1);
  if (!row || Date.now() - Date.parse(row.fetchedAt) > ASPSP_CACHE_MS) return null;
  try {
    return JSON.parse(row.data) as EbAspsp[];
  } catch {
    return null;
  }
}

/** The banks of one country (personal accounts), cached for a day. */
export const listAspspsHandler: Handler<"bank.list_aspsps"> = async (payload, ctx) => {
  const country = payloadString(payload, "country", 2);
  if (!isBankSyncCountry(country)) throw bug("invalid_payload", "Unsupported country");
  let aspsps = await cachedAspsps(country);
  if (!aspsps) {
    const credential = await loadCredential(ctx.userId, { requireVerified: true });
    aspsps = (await clientFor(credential).listAspsps(country)).filter(
      (a) => a.country === country && (a.psuTypes.length === 0 || a.psuTypes.includes("personal")),
    );
    const now = new Date().toISOString();
    await db
      .insert(bankAspspCache)
      .values({ country, data: JSON.stringify(aspsps), fetchedAt: now })
      .onConflictDoUpdate({ target: bankAspspCache.country, set: { data: JSON.stringify(aspsps), fetchedAt: now } });
  }
  const options: AspspOption[] = aspsps
    .map((a) => ({
      name: a.name,
      country: a.country,
      maxConsentDays: a.maximumConsentValidity ? Math.floor(a.maximumConsentValidity / 86_400) : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { aspsps: options };
};

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/**
 * Start a trip to the bank. The state is minted HERE: 256 random bits, of
 * which only the hash is stored — the raw value goes to Enable Banking and
 * comes back in the callback, and is never written down on our side.
 */
export const startAuthHandler: Handler<"bank.start_auth"> = async (payload, ctx) => {
  const sessionId = payloadString(payload, "sessionId");
  const purpose = payloadString(payload, "purpose", 16);
  if (purpose !== "connect" && purpose !== "reconnect") throw bug("invalid_payload", "Bad purpose");
  const aspspName = payloadString(payload, "aspspName");
  const aspspCountry = payloadString(payload, "aspspCountry", 2);
  if (!isBankSyncCountry(aspspCountry)) throw bug("invalid_payload", "Unsupported country");
  const connectionId = optionalPayloadString(payload, "connectionId");

  if (purpose === "reconnect") {
    if (!connectionId) throw bug("invalid_payload", "Reconnect without connection");
    const connection = await loadConnection(ctx.userId, connectionId);
    if (connection.aspspName !== aspspName || connection.aspspCountry !== aspspCountry) {
      throw bug("invalid_payload", "Reconnect must stay with the same bank");
    }
  }

  const credential = await loadCredential(ctx.userId, { requireVerified: true });

  // Ask for as long a consent as the bank allows, capped at 180 days.
  const aspsp = (await cachedAspsps(aspspCountry))?.find((a) => a.name === aspspName);
  const capDays = Math.min(
    MAX_CONSENT_DAYS,
    aspsp?.maximumConsentValidity ? Math.floor(aspsp.maximumConsentValidity / 86_400) : MAX_CONSENT_DAYS,
  );
  // A minute short of the cap: "exactly the maximum" is easy to overshoot.
  const validUntil = new Date(Date.now() + capDays * 86_400_000 - 60_000);

  const state = randomBytes(32).toString("base64url");
  const now = Date.now();
  await db.insert(bankAuthStates).values({
    userId: ctx.userId,
    sessionId,
    stateHash: sha256(state),
    purpose,
    aspspName,
    aspspCountry,
    connectionId: connectionId ?? null,
    expiresAt: new Date(now + AUTH_STATE_TTL_MS).toISOString(),
    createdAt: new Date(now).toISOString(),
  });

  const { url } = await clientFor(credential).startAuth({
    aspspName,
    aspspCountry,
    state,
    redirectUrl: bankSyncRedirectUrl(),
    validUntil,
  });
  return { url };
};

function accountsJson(accounts: EbSessionAccount[]): string {
  return JSON.stringify(
    accounts.map((a) => ({
      uid: a.uid,
      iban: normalizeIban(a.iban),
      name: a.name,
      currency: a.currency,
    })),
  );
}

/**
 * The bank sent the user back: exchange the one-time code for a session.
 * The callback route has already checked the state against this user and
 * session and marked it used; here it must still be unexpired and not yet
 * completed — a code can be exchanged once.
 */
export const completeAuthHandler: Handler<"bank.complete_auth"> = async (payload, ctx) => {
  const authStateId = payloadString(payload, "authStateId");
  const code = payloadString(payload, "code", 2000);

  const [state] = await db
    .select()
    .from(bankAuthStates)
    .where(
      and(
        eq(bankAuthStates.id, authStateId),
        eq(bankAuthStates.userId, ctx.userId),
        isNotNull(bankAuthStates.usedAt),
        isNull(bankAuthStates.completedAt),
        gt(bankAuthStates.expiresAt, new Date().toISOString()),
      ),
    )
    .limit(1);
  if (!state) throw userAction("auth_state_invalid", "This bank authorisation is no longer valid");

  const credential = await loadCredential(ctx.userId, { requireVerified: true });
  const client = clientFor(credential);
  let session;
  try {
    session = await client.createSession(code);
  } catch (err) {
    // A code is single use: a retry can't succeed, so tell the user to start over.
    if (err instanceof JobError && err.kind === "bug") throw userAction("auth_failed", "The bank did not accept the authorisation");
    throw err;
  }
  const now = new Date().toISOString();

  if (state.purpose === "reconnect") {
    if (!state.connectionId) throw bug("invalid_payload", "Reconnect state without connection");
    const connection = await loadConnection(ctx.userId, state.connectionId);
    const oldSession = connection.sessionIdEnc ? sessionIdOf(connection) : null;
    const links = await db
      .select()
      .from(bankAccountLinks)
      .where(and(eq(bankAccountLinks.connectionId, connection.id), eq(bankAccountLinks.userId, ctx.userId)));
    const byIban = new Map(session.accounts.map((a) => [normalizeIban(a.iban), a]));

    await db.transaction(async (tx) => {
      await tx
        .update(bankConnections)
        .set({
          sessionIdEnc: sealSessionId(ctx.userId, connection.id, session.sessionId),
          validUntil: session.validUntil,
          availableAccounts: accountsJson(session.accounts),
          status: "active",
          lastErrorCode: null,
          expiryNotifiedAt: null,
          updatedAt: now,
        })
        .where(and(eq(bankConnections.id, connection.id), eq(bankConnections.userId, ctx.userId)));
      // Account uids are per session: re-bind each link through its IBAN.
      for (const link of links) {
        const match = link.iban ? byIban.get(normalizeIban(link.iban)) : undefined;
        await tx
          .update(bankAccountLinks)
          .set(
            match
              ? { externalUid: match.uid, lastErrorCode: null, updatedAt: now }
              : { lastErrorCode: "account_gone", updatedAt: now },
          )
          .where(and(eq(bankAccountLinks.id, link.id), eq(bankAccountLinks.userId, ctx.userId)));
      }
      await tx
        .update(bankAuthStates)
        .set({ completedAt: now })
        .where(and(eq(bankAuthStates.id, state.id), eq(bankAuthStates.userId, ctx.userId)));
    });
    // The old consent is superseded; end it at the bank too. Best effort —
    // it may well have expired already, which is why we're here.
    if (oldSession && oldSession !== session.sessionId) {
      await client.deleteSession(oldSession).catch(() => {});
    }
    logDataEvent({
      userId: ctx.userId,
      action: "bank_connection_renewed",
      targetId: connection.id,
      targetType: "bank_connection",
      details: { aspsp: connection.aspspName },
    });
    await notifyBankEvent(ctx.userId, "bankConnected", { bank: connection.aspspName });
    return { connectionId: connection.id, purpose: "reconnect" };
  }

  const connectionId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(bankConnections).values({
      id: connectionId,
      userId: ctx.userId,
      credentialId: credential.id,
      aspspName: state.aspspName,
      aspspCountry: state.aspspCountry,
      sessionIdEnc: sealSessionId(ctx.userId, connectionId, session.sessionId),
      validUntil: session.validUntil,
      status: "active",
      availableAccounts: accountsJson(session.accounts),
      createdAt: now,
      updatedAt: now,
    });
    // The mapping screen is open for exactly this connection, until the
    // state expires or the mapping is saved.
    await tx
      .update(bankAuthStates)
      .set({ connectionId })
      .where(and(eq(bankAuthStates.id, state.id), eq(bankAuthStates.userId, ctx.userId)));
  });
  logDataEvent({
    userId: ctx.userId,
    action: "bank_connected",
    targetId: connectionId,
    targetType: "bank_connection",
    details: { aspsp: state.aspspName, accounts: session.accounts.length },
  });
  await notifyBankEvent(ctx.userId, "bankConnected", { bank: state.aspspName });
  return { connectionId, purpose: "connect" };
};

/**
 * Disconnect: end the consent at the bank, then forget the connection and its
 * links. The transactions it brought in stay.
 */
export const revokeSessionHandler: Handler<"bank.revoke_session"> = async (payload, ctx) => {
  const connectionId = payloadString(payload, "connectionId");
  const [connection] = await db
    .select()
    .from(bankConnections)
    .where(and(eq(bankConnections.id, connectionId), eq(bankConnections.userId, ctx.userId)))
    .limit(1);
  if (!connection) return { revoked: false };

  if (connection.sessionIdEnc && connection.status === "active") {
    try {
      const credential = await loadCredential(ctx.userId, { requireVerified: false });
      await clientFor(credential).deleteSession(sessionIdOf(connection));
    } catch (err) {
      // Network trouble: retry, revoking is the point. A key or consent the
      // provider no longer accepts can't be revoked by us; forget it locally.
      if (err instanceof JobError && (err.kind === "retry" || err.kind === "rate_limited")) throw err;
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(bankAccountLinks)
      .where(and(eq(bankAccountLinks.connectionId, connection.id), eq(bankAccountLinks.userId, ctx.userId)));
    await tx
      .delete(bankConnections)
      .where(and(eq(bankConnections.id, connection.id), eq(bankConnections.userId, ctx.userId)));
  });
  logDataEvent({
    userId: ctx.userId,
    action: "bank_disconnected",
    targetId: connection.id,
    targetType: "bank_connection",
    details: { aspsp: connection.aspspName },
  });
  return { revoked: true };
};
