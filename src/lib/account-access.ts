import { and, asc, eq, or, inArray, isNull, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts, accountMembers, categories, transactions, user, type Account } from "@/db/schema";

/**
 * Shared-account access. Ownership lives on accounts.user_id; everything else
 * comes from account_members rows (see schema). Data rows (transactions,
 * budgets, …) always keep the OWNER's user_id — sharing only widens who may
 * query them, which is why every read path scopes by account id from
 * `memberAccountIds` and never rewrites user_id.
 */
export type AccountRole = "owner" | "editor" | "viewer";

/** WHERE fragment: account_members rows that make `userId` an active member. */
export function activeMembership(userId: string) {
  return and(
    eq(accountMembers.userId, userId),
    isNotNull(accountMembers.acceptedAt),
    isNull(accountMembers.revokedAt),
  );
}

/**
 * Subquery of account ids actively shared with `userId`, for use in
 * `inArray(transactions.accountId, memberAccountIds(userId))` and friends.
 * Names user_id, so queries built on it pass the tenant guard honestly.
 */
export function memberAccountIds(userId: string) {
  return db
    .select({ id: accountMembers.accountId })
    .from(accountMembers)
    .where(activeMembership(userId));
}

/**
 * WHERE fragment: transactions `userId` may read — their own rows plus rows on
 * accounts actively shared with them. Rows on shared accounts keep the OWNER's
 * user_id, so plain `eq(transactions.userId, me)` misses them. Names user_id
 * on both branches, so the tenant guard passes honestly.
 */
export function visibleTransactions(userId: string) {
  return or(
    eq(transactions.userId, userId),
    inArray(transactions.accountId, memberAccountIds(userId)),
  )!;
}

/** Subquery of account ids where `userId` has an active EDITOR membership. */
export function writableMemberAccountIds(userId: string) {
  return db
    .select({ id: accountMembers.accountId })
    .from(accountMembers)
    .where(and(activeMembership(userId), eq(accountMembers.role, "editor")));
}

/**
 * WHERE fragment: transactions `userId` may WRITE to — their own rows plus
 * rows on accounts where they hold an active editor membership. Narrower than
 * `visibleTransactions`: viewer-shared accounts are readable but not here.
 * For bulk endpoints (id list, no single accountId to gate up front) that
 * must silently skip ids the caller can't write to rather than 403 the whole
 * batch.
 */
export function writableTransactions(userId: string) {
  return or(
    eq(transactions.userId, userId),
    inArray(transactions.accountId, writableMemberAccountIds(userId)),
  )!;
}

/** WHERE fragment for the accounts table: own accounts plus actively shared ones. */
export function visibleAccounts(userId: string) {
  return or(
    eq(accounts.userId, userId),
    inArray(accounts.id, memberAccountIds(userId)),
  )!;
}

/**
 * WHERE fragment for the categories table: the user's own categories plus
 * those of owners who share an account with them — shared rows carry the
 * OWNER's category ids, and the member must be able to resolve their labels.
 */
export function visibleCategories(userId: string) {
  return or(
    eq(categories.userId, userId),
    inArray(
      categories.userId,
      db
        .select({ id: accounts.userId })
        .from(accountMembers)
        .innerJoin(accounts, eq(accounts.id, accountMembers.accountId))
        .where(activeMembership(userId)),
    ),
  )!;
}

/** A person an account is shared with. Name/image stay null until they accept. */
export type SharedWithUser = {
  name: string | null;
  image: string | null;
  email: string | null;
};

export type AccessibleAccount = Account & {
  role: AccountRole;
  /** Display name of the sharing owner; null for the user's own accounts. */
  ownerName: string | null;
  /** Profile picture of the sharing owner; null for the user's own accounts. */
  ownerImage: string | null;
  /** People this account is shared with (pending invites included); 0 unless you own it. */
  sharedWith: number;
  /** The same people, with faces for the card badge; empty unless you own it. */
  sharedWithUsers: SharedWithUser[];
};

/** The user's own accounts plus accounts actively shared with them. */
export async function getAccessibleAccounts(userId: string): Promise<AccessibleAccount[]> {
  const own = await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .orderBy(asc(accounts.sortOrder), asc(accounts.createdAt));
  const shared = await db
    .select({
      account: accounts,
      role: accountMembers.role,
      ownerName: user.name,
      ownerImage: user.image,
    })
    .from(accountMembers)
    .innerJoin(accounts, eq(accounts.id, accountMembers.accountId))
    .innerJoin(user, eq(user.id, accounts.userId))
    .where(activeMembership(userId));
  // One pass over every live invite on the user's accounts — the card badge
  // must not N+1 the members endpoint. Joins accounts so the statement names
  // user_id honestly; left-joins user because a pending invite has no user yet.
  const shares = await db
    .select({
      accountId: accountMembers.accountId,
      email: accountMembers.email,
      name: user.name,
      image: user.image,
    })
    .from(accountMembers)
    .innerJoin(accounts, eq(accounts.id, accountMembers.accountId))
    .leftJoin(user, eq(user.id, accountMembers.userId))
    .where(and(eq(accounts.userId, userId), isNull(accountMembers.revokedAt)))
    // Stable face order on the card — id breaks ties when two invites share a
    // created_at, which same-millisecond inserts do.
    .orderBy(asc(accountMembers.createdAt), asc(accountMembers.id));
  const sharedWithByAccount = new Map<string, SharedWithUser[]>();
  for (const s of shares) {
    const list = sharedWithByAccount.get(s.accountId) ?? [];
    list.push({ name: s.name, image: s.image, email: s.email });
    sharedWithByAccount.set(s.accountId, list);
  }
  return [
    ...own.map((a) => {
      const people = sharedWithByAccount.get(a.id) ?? [];
      return {
        ...a,
        role: "owner" as const,
        ownerName: null,
        ownerImage: null,
        sharedWith: people.length,
        sharedWithUsers: people,
      };
    }),
    ...shared.map((s) => ({
      ...s.account,
      role: s.role,
      ownerName: s.ownerName,
      ownerImage: s.ownerImage,
      sharedWith: 0,
      sharedWithUsers: [],
    })),
  ];
}

/** The user's access to one account, or null — no access and no such account look the same. */
export async function getAccountAccess(
  userId: string,
  accountId: string,
): Promise<{ account: Account; role: AccountRole } | null> {
  const [own] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
  if (own) return { account: own, role: "owner" };
  const [shared] = await db
    .select({ account: accounts, role: accountMembers.role })
    .from(accountMembers)
    .innerJoin(accounts, eq(accounts.id, accountMembers.accountId))
    .where(and(eq(accountMembers.accountId, accountId), activeMembership(userId)));
  return shared ? { account: shared.account, role: shared.role } : null;
}

/**
 * Route-handler gate (withUser catches the thrown Response). 404 when the
 * user can't see the account — existence stays hidden, matching the
 * ownership-check-doubles-as-404 convention. 403 only distinguishes "you can
 * see this but not change it" for viewers. "manage" (membership, delete) is
 * owner-only.
 */
export async function requireAccountAccess(
  userId: string,
  accountId: string,
  level: "read" | "write" | "manage",
): Promise<{ account: Account; role: AccountRole }> {
  const access = await getAccountAccess(userId, accountId);
  if (!access) throw Response.json({ error: "Account not found" }, { status: 404 });
  if (level === "write" && access.role === "viewer")
    throw Response.json({ error: "Read-only access" }, { status: 403 });
  if (level === "manage" && access.role !== "owner")
    throw Response.json({ error: "Only the owner can do this" }, { status: 403 });
  return access;
}
