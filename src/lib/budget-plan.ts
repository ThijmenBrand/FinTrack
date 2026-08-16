import { db } from "@/db";
import { accounts, accountMembers, budgetPlans, transactions, user } from "@/db/schema";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { activeMembership, type AccountRole } from "@/lib/account-access";
import { getUserPreferences } from "@/lib/preferences";

export interface ResolvedBudgetPlan {
  id: string;
  name: string;
  isMain: boolean;
  /** "yearly" plans carry one annual envelope per category — see budget-ledger.ts. */
  period: "monthly" | "yearly";
  /** First financial month the yearly envelope covers; null while monthly. */
  periodStartedAt: string | null;
  accountIds: string[];
  /** The plan's owner. Equals the caller for own plans; plan-scoped math must run as this user. */
  ownerId: string;
  /**
   * "owner" for own plans. For a plan reached through a shared account, the
   * HIGHEST role among the caller's active memberships on the plan's
   * accounts — "editor" if they can write to any of them, else "viewer".
   */
  role: AccountRole;
  /** Display name of the sharing owner; null for own plans. */
  ownerName: string | null;
}

/**
 * A plan the user can read, by id — or their own main plan when `budgetId` is
 * null. Own plans resolve as before; a foreign plan resolves when at least one
 * of its accounts is actively shared with the user (role "editor" or
 * "viewer", see ResolvedBudgetPlan.role). Returns null when there is no such
 * accessible plan.
 */
export async function resolveBudgetPlan(
  userId: string,
  budgetId?: string | null,
): Promise<ResolvedBudgetPlan | null> {
  let [plan] = await db
    .select()
    .from(budgetPlans)
    .where(
      and(
        eq(budgetPlans.userId, userId),
        budgetId ? eq(budgetPlans.id, budgetId) : eq(budgetPlans.isMain, true),
      ),
    )
    .limit(1);
  let role: AccountRole = "owner";
  let ownerName: string | null = null;
  let isForeign = false;

  if (!plan && budgetId) {
    const [shared] = await db
      .select({ plan: budgetPlans, ownerName: user.name })
      .from(accountMembers)
      .innerJoin(accounts, eq(accounts.id, accountMembers.accountId))
      .innerJoin(
        budgetPlans,
        and(eq(budgetPlans.id, accounts.budgetId), eq(budgetPlans.id, budgetId)),
      )
      .innerJoin(user, eq(user.id, budgetPlans.userId))
      .where(activeMembership(userId))
      .limit(1);
    if (shared) {
      plan = shared.plan;
      ownerName = shared.ownerName;
      isForeign = true;
    }
  }
  if (!plan) return null;

  // Plan accounts belong to the plan's owner — ownerId comes off the plan row
  // whose accessibility was just verified, keeping the cross-user intent explicit.
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, plan.userId), eq(accounts.budgetId, plan.id)));

  // A foreign plan's role is the HIGHEST role among the caller's active
  // memberships on the plan's own accounts — one editor membership makes the
  // whole plan editable, even if the caller is only a viewer on its other
  // accounts.
  if (isForeign) {
    const accountIds = rows.map((r) => r.id);
    const memberships = accountIds.length
      ? await db
          .select({ role: accountMembers.role })
          .from(accountMembers)
          .where(and(inArray(accountMembers.accountId, accountIds), activeMembership(userId)))
      : [];
    role = memberships.some((m) => m.role === "editor") ? "editor" : "viewer";
  }

  return {
    id: plan.id,
    name: plan.name,
    isMain: plan.isMain,
    period: plan.period,
    periodStartedAt: plan.periodStartedAt,
    accountIds: rows.map((r) => r.id),
    ownerId: plan.userId,
    role,
    ownerName,
  };
}

/**
 * The plan the user's dashboard budgets on: their chosen main
 * (userPreferences.mainBudgetPlanId — possibly a shared plan), falling back to
 * their own is_main plan when unset, inaccessible, or deleted.
 */
export async function resolveMainPlan(userId: string): Promise<ResolvedBudgetPlan | null> {
  const prefs = await getUserPreferences(userId);
  if (prefs.mainBudgetPlanId) {
    const chosen = await resolveBudgetPlan(userId, prefs.mainBudgetPlanId);
    if (chosen) return chosen;
  }
  return resolveBudgetPlan(userId, null);
}

/**
 * The financialMonthStartDay plan-scoped math must use: the plan OWNER's, so
 * owner and member see identical numbers for a shared plan. Falls back to
 * `ownStartDay` for own plans (or no plan).
 */
export async function effectiveStartDay(
  userId: string,
  plan: ResolvedBudgetPlan | null,
  ownStartDay: number,
): Promise<number> {
  if (!plan || plan.ownerId === userId) return ownStartDay;
  return (await getUserPreferences(plan.ownerId)).financialMonthStartDay;
}

export type BudgetRowAccess =
  | { ok: true; dataUserId: string }
  | { ok: false; status: 403 | 404 };

/**
 * Write access to a `budgets` (or `budget_sub_lines`) row a caller named by
 * id, for endpoints that only take the row id — not a budgetId — in the
 * request (PUT/DELETE .../budgets, .../budgets/sub-lines). The row's own
 * `userId` is the owner whose space every write must land in.
 *
 * Own row → owner access. Otherwise the row's `budgetId` must resolve, for
 * the caller, to a plan owned by the row's user with role "owner" or
 * "editor" — 404 when the caller can't see the plan at all (existence stays
 * hidden), 403 when they can see it but are a viewer.
 */
export async function resolveBudgetRowAccess(
  actingUserId: string,
  row: { userId: string; budgetId: string | null },
): Promise<BudgetRowAccess> {
  if (row.userId === actingUserId) return { ok: true, dataUserId: actingUserId };
  if (!row.budgetId) return { ok: false, status: 404 };
  const plan = await resolveBudgetPlan(actingUserId, row.budgetId);
  if (!plan || plan.ownerId !== row.userId) return { ok: false, status: 404 };
  if (plan.role === "viewer") return { ok: false, status: 403 };
  return { ok: true, dataUserId: row.userId };
}

/**
 * WHERE fragment restricting transactions to a set of accounts. An empty set
 * matches nothing — a plan with no accounts has no spending, it doesn't fall
 * back to "all accounts". Undefined means no restriction.
 */
export function accountScopeFilter(accountIds: string[] | undefined): SQL | undefined {
  if (accountIds === undefined) return undefined;
  if (accountIds.length === 0) return sql`1=0`;
  return inArray(transactions.accountId, accountIds);
}
