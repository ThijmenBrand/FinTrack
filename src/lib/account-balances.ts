/**
 * Current balance of every account the user can see (own and shared). Shared
 * by the dashboard's accounts card and the low-balance notification.
 */
import { cache } from "react";
import { db } from "@/db";
import { accounts, transactions, accountMembers, user } from "@/db/schema";
import { eq, and, sql, isNull } from "drizzle-orm";
import { activeMembership, visibleAccounts } from "@/lib/account-access";
import { excludeSplitChildren } from "@/lib/split-sql";

export const getAccountBalances = cache(async (userId: string) => {
  const [accountBalanceRows, ownerRows, shareRows] = await Promise.all([
    db
      .select({
        id: accounts.id,
        userId: accounts.userId,
        name: accounts.name,
        type: accounts.type,
        bank: accounts.bank,
        bankName: accounts.bankName,
        iban: accounts.iban,
        currency: accounts.currency,
        initialBalance: accounts.initialBalance,
        sortOrder: accounts.sortOrder,
        createdAt: accounts.createdAt,
        updatedAt: accounts.updatedAt,
        txTotal: sql<number>`COALESCE(SUM(${transactions.amount}), 0)`,
      })
      .from(accounts)
      // Split children are excluded in the JOIN, not the WHERE: a left join
      // filtered afterwards would drop accounts with no transactions at all.
      // The parent keeps the real bank amount, so its children would double it.
      .leftJoin(
        transactions,
        and(eq(accounts.id, transactions.accountId), excludeSplitChildren()),
      )
      // Own accounts plus shared ones; a shared account's rows all belong to its
      // owner, so joining by account id already sums the right transactions.
      .where(visibleAccounts(userId))
      .groupBy(accounts.id),
    // Separate query: joining accountMembers/user onto the aggregate above
    // would multiply rows before the SUM groups them.
    db
      .select({
        accountId: accountMembers.accountId,
        ownerName: user.name,
        ownerImage: user.image,
      })
      .from(accountMembers)
      .innerJoin(accounts, eq(accounts.id, accountMembers.accountId))
      .innerJoin(user, eq(user.id, accounts.userId))
      .where(activeMembership(userId)),
    // Faces for the shared badge on accounts the user owns. Left-joins user
    // because a pending invite has no user row yet.
    db
      .select({
        accountId: accountMembers.accountId,
        email: accountMembers.email,
        name: user.name,
        image: user.image,
      })
      .from(accountMembers)
      .innerJoin(accounts, eq(accounts.id, accountMembers.accountId))
      .leftJoin(user, eq(user.id, accountMembers.userId))
      .where(and(eq(accounts.userId, userId), isNull(accountMembers.revokedAt))),
  ]);
  const ownerByAccount = new Map(ownerRows.map((r) => [r.accountId, r]));
  const sharedByAccount = new Map<string, { name: string | null; image: string | null; email: string | null }[]>();
  for (const s of shareRows) {
    const list = sharedByAccount.get(s.accountId) ?? [];
    list.push({ name: s.name, image: s.image, email: s.email });
    sharedByAccount.set(s.accountId, list);
  }

  return accountBalanceRows.map((row) => ({
    ...row,
    currentBalance: row.initialBalance + Number(row.txTotal),
    ownerName: ownerByAccount.get(row.id)?.ownerName ?? null,
    ownerImage: ownerByAccount.get(row.id)?.ownerImage ?? null,
    sharedWithUsers: sharedByAccount.get(row.id) ?? [],
  }));
});
