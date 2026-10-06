import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { account, passkey, session, sessionActivity, user } from "@/db/schema";
import { createRateLimiter } from "@/lib/rate-limit";

/**
 * Idle lock: the device stays signed in for weeks (better-auth's session
 * lifetime in src/lib/auth.ts), but after an hour without a request the
 * session locks and every route answers with the lock screen until the user
 * proves it's them again — a passkey (Face ID / Touch ID) or their password.
 *
 * Same bar as the old 1h idle expiry, so an abandoned phone or tab is no more
 * exposed than before; coming back just costs one tap instead of a sign-in.
 * Enforced in src/proxy.ts, so it covers pages and API routes alike.
 */

export const LOCK_AFTER_MS = 60 * 60_000;

/** Activity is written at most this often — not on every request. */
export const TOUCH_EVERY_MS = 60_000;

/** Wrong passwords on the lock screen before the session is signed out. */
export const MAX_UNLOCK_FAILURES = 5;

/**
 * Unlock attempts per user per five minutes, any method — a brake on one
 * instance. The durable limit is MAX_UNLOCK_FAILURES, which survives restarts.
 */
export const allowUnlockAttempt = createRateLimiter(5 * 60_000, 10);

export interface LockState {
  locked: boolean;
  /** Unlocked, and the stored activity is old enough to be worth refreshing. */
  touch: boolean;
}

/**
 * Pure lock decision. `lastActiveAt` is null for a session that has had no
 * activity written since sign-in, which then counts from its creation. A
 * timestamp that doesn't parse locks — never the other way round.
 */
export function lockState(
  lastActiveAt: Date | null,
  sessionCreatedAt: Date,
  now: number = Date.now(),
): LockState {
  const last = (lastActiveAt ?? sessionCreatedAt).getTime();
  if (!Number.isFinite(last)) return { locked: true, touch: false };
  const idle = now - last;
  if (idle >= LOCK_AFTER_MS) return { locked: true, touch: false };
  return { locked: false, touch: idle >= TOUCH_EVERY_MS || lastActiveAt === null };
}

/**
 * Requests that a locked session may still make. Nothing here reads finance
 * data or changes the account: the lock screen itself, signing out, the
 * token-carrying links from emails, and the static files a page needs to paint.
 * They also don't count as activity, so the lock screen can't keep itself open.
 */
export function isLockExempt(pathname: string, method: string): boolean {
  if (pathname === "/unlock" || pathname === "/api/unlock" || pathname.startsWith("/api/unlock/")) {
    return true;
  }
  if (
    pathname === "/api/auth/sign-out" ||
    pathname.startsWith("/api/auth/verify-email") ||
    pathname.startsWith("/api/auth/reset-password") ||
    pathname === "/sw.js" ||
    pathname === "/manifest.json" ||
    pathname.startsWith("/apple-touch-icon")
  ) {
    return true;
  }
  // The lock screen shows the user's own face. Any signed-in user can already
  // read any avatar, so this hands a locked session nothing new.
  return method === "GET" && pathname.startsWith("/api/avatar/");
}

/** Read a session's last activity and decide whether it is locked. */
export async function readLockState(
  sessionId: string,
  now: number = Date.now(),
): Promise<LockState> {
  const [row] = await db
    .select({ createdAt: session.createdAt, lastActiveAt: sessionActivity.lastActiveAt })
    .from(session)
    .leftJoin(sessionActivity, eq(sessionActivity.sessionId, session.id))
    .where(eq(session.id, sessionId))
    .limit(1);
  if (!row) return { locked: true, touch: false };
  return lockState(row.lastActiveAt, row.createdAt, now);
}

/** Record activity on an unlocked session. */
export async function touchSession(
  sessionId: string,
  userId: string,
  now: number = Date.now(),
): Promise<void> {
  const at = new Date(now);
  await db
    .insert(sessionActivity)
    .values({ sessionId, userId, lastActiveAt: at })
    .onConflictDoUpdate({
      target: sessionActivity.sessionId,
      set: { lastActiveAt: at },
    });
}

/** The user proved it's them: the session is fresh again. */
export async function unlockSession(
  sessionId: string,
  userId: string,
  now: number = Date.now(),
): Promise<void> {
  const at = new Date(now);
  await db
    .insert(sessionActivity)
    .values({ sessionId, userId, lastActiveAt: at, unlockFailures: 0 })
    .onConflictDoUpdate({
      target: sessionActivity.sessionId,
      set: { lastActiveAt: at, unlockFailures: 0 },
    });
}

/**
 * Count a wrong password against this session. At MAX_UNLOCK_FAILURES the
 * session is deleted outright, so guessing moves on to the sign-in form and
 * its own rate limits. Returns the attempts left (0 = signed out).
 *
 * Kept in the database, not in memory: serverless instances don't share a
 * process, so an in-memory counter would reset with every cold start.
 */
export async function recordUnlockFailure(
  sessionId: string,
  userId: string,
): Promise<number> {
  const [row] = await db
    .insert(sessionActivity)
    // A session with no activity row is locked from its creation time, so
    // the row's timestamp is irrelevant here — epoch keeps it locked.
    .values({ sessionId, userId, lastActiveAt: new Date(0), unlockFailures: 1 })
    .onConflictDoUpdate({
      target: sessionActivity.sessionId,
      set: { unlockFailures: sql`${sessionActivity.unlockFailures} + 1` },
    })
    .returning({ failures: sessionActivity.unlockFailures });
  const left = MAX_UNLOCK_FAILURES - (row?.failures ?? MAX_UNLOCK_FAILURES);
  if (left <= 0) {
    await db.delete(session).where(and(eq(session.id, sessionId), eq(session.userId, userId)));
    return 0;
  }
  return left;
}

export interface UnlockMethods {
  passkey: boolean;
  /** Administrators unlock with a passkey or sign in again — the backoffice
   *  demands a second factor, and a password alone isn't one. */
  password: boolean;
}

export async function unlockMethods(userId: string): Promise<UnlockMethods> {
  const [[u], [pk], [credential]] = await Promise.all([
    db.select({ role: user.role }).from(user).where(eq(user.id, userId)).limit(1),
    db.select({ id: passkey.id }).from(passkey).where(eq(passkey.userId, userId)).limit(1),
    db
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
      .limit(1),
  ]);
  return { passkey: !!pk, password: u?.role !== "admin" && !!credential };
}
