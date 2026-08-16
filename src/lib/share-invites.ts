import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accountMembers, accounts, user, type AccountMember } from "@/db/schema";
import { hashInviteToken, inviteStatus } from "@/lib/invites";

/**
 * The account_members side of the invite lifecycle: everything the share
 * routes need beyond a plain query, so the route files stay thin.
 */

/** A household, not a company — keeps one account's member list reviewable. */
export const MAX_MEMBERS_PER_ACCOUNT = 10;

export type ShareRole = "viewer" | "editor";

export function isShareRole(value: unknown): value is ShareRole {
  return value === "viewer" || value === "editor";
}

/**
 * Account ids owned by `ownerId`. Membership writes filter on this instead of
 * the account id alone: it names user_id, so they pass the tenant guard
 * honestly and can't touch another owner's rows even if an id leaks.
 */
export function ownedAccountIds(ownerId: string) {
  return db.select({ id: accounts.id }).from(accounts).where(eq(accounts.userId, ownerId));
}

/** Non-revoked rows (pending + accepted) on one owned account. */
export async function countLiveMembers(accountId: string, ownerId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(accountMembers)
    .where(
      and(
        eq(accountMembers.accountId, accountId),
        inArray(accountMembers.accountId, ownedAccountIds(ownerId)),
        isNull(accountMembers.revokedAt),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Did this write lose the race for the partial unique index on
 * (account_id, email)? Drizzle wraps the libsql error, so the constraint code
 * sits one level down on `cause` — checking only the top message misses it.
 */
export function isUniqueViolation(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string } })?.cause;
  return (
    cause?.code === "SQLITE_CONSTRAINT_UNIQUE" ||
    /UNIQUE constraint/.test(String(cause ?? err))
  );
}

export interface PendingShareInvite {
  member: AccountMember;
  accountName: string;
  ownerId: string;
  ownerName: string | null;
}

/**
 * Look up a share invite by its raw token, or null when it is anything other
 * than pending (accepted, revoked, expired, unknown — all indistinguishable to
 * the caller on purpose).
 *
 * ponytail: no rate limit — the token is 256 random bits (see invites.ts).
 */
export async function findPendingShareInvite(
  token: unknown,
): Promise<PendingShareInvite | null> {
  if (typeof token !== "string" || !token) return null;
  const row = await db
    .select({
      member: accountMembers,
      accountName: accounts.name,
      ownerId: accounts.userId,
      ownerName: user.name,
    })
    .from(accountMembers)
    .innerJoin(accounts, eq(accounts.id, accountMembers.accountId))
    .innerJoin(user, eq(user.id, accounts.userId))
    .where(eq(accountMembers.tokenHash, hashInviteToken(token)))
    .get();
  // A row with no expiry can never be pending — "" sorts before every ISO date.
  if (!row || inviteStatus({ ...row.member, expiresAt: row.member.expiresAt ?? "" }) !== "pending")
    return null;
  return row;
}

/**
 * Bind a pending invite to its new member and burn the token, so the link is
 * single-use. The WHERE clause makes a double accept a no-op.
 */
export async function acceptShareInvite(memberId: string, userId: string): Promise<void> {
  await db
    .update(accountMembers)
    .set({ userId, acceptedAt: new Date().toISOString(), tokenHash: null, expiresAt: null })
    .where(
      and(
        eq(accountMembers.id, memberId),
        isNull(accountMembers.acceptedAt),
        isNull(accountMembers.revokedAt),
      ),
    );
}
