import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import { accountMembers, accounts, budgetMonthTargets, budgetPlans, budgets, budgetSubLines, user } from "@/db/schema";
import { eq, and, asc, inArray, isNull, notInArray } from "drizzle-orm";
import { activeMembership } from "@/lib/account-access";
import { withUser } from "@/lib/auth";
import { logDataEvent } from "@/lib/audit";
import { BUDGETABLE_ACCOUNT_TYPES } from "@/lib/account-scope";
import { getUserPreferences } from "@/lib/preferences";
import { getFinancialMonthRange } from "@/lib/financial-month";
import { clearLedger } from "@/lib/budget-ledger-db";
import { memberSharePercents } from "@/lib/budget-split";

const MAX_NAME_LENGTH = 60;
const MAX_SHARE_MEMBERS = 50;
const PERIODS = ["monthly", "yearly"] as const;
type PlanPeriod = (typeof PERIODS)[number];

function validName(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.trim().length <= MAX_NAME_LENGTH;
}

function isPeriod(v: unknown): v is PlanPeriod {
  return typeof v === "string" && (PERIODS as readonly string[]).includes(v);
}

/** Whole percent of a shared budget one person carries. */
function isSharePercent(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100;
}

/** Per-member percentages, keyed by the address they were invited on. */
function isShareMap(v: unknown): v is Record<string, number> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const entries = Object.entries(v);
  // ponytail: shape and size only. Keys that are not (or no longer) members of
  // the plan are inert — nothing reads them, and the next save drops them.
  return (
    entries.length <= MAX_SHARE_MEMBERS &&
    entries.every(([email, pct]) => email.length > 0 && email.length <= 254 && isSharePercent(pct))
  );
}

/** Owner plus members must carry the whole budget between them. */
function shareTotalIs100(owner: number, shares: Record<string, number>): boolean {
  return owner + Object.values(shares).reduce((sum, pct) => sum + pct, 0) === 100;
}

/**
 * Invite addresses the plan's accounts are currently shared with — the only
 * keys a stored cost-split key may carry. Revoked invites are left out; a
 * pending one counts, since it is already shown on the plan.
 */
async function planMemberEmails(ownerId: string, planId: string): Promise<string[]> {
  const rows = await db
    .select({ email: accountMembers.email })
    .from(accountMembers)
    .innerJoin(accounts, eq(accounts.id, accountMembers.accountId))
    .where(
      and(
        eq(accounts.userId, ownerId),
        eq(accounts.budgetId, planId),
        isNull(accountMembers.revokedAt),
      ),
    );
  return [...new Set(rows.map((r) => r.email))];
}

function parseShares(json: string | null): Record<string, number> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return isShareMap(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * The financial month a yearly envelope starts in when a plan is switched
 * today. Switching mid-year starts the carry-over here rather than
 * backfilling months the user never budgeted — see planStartMonthIndex.
 */
async function currentMonthStart(userId: string): Promise<string> {
  const prefs = await getUserPreferences(userId);
  return getFinancialMonthRange(new Date(), prefs.financialMonthStartDay).from;
}

async function listPlans(userId: string) {
  const [plans, memberAccounts] = await Promise.all([
    db
      .select()
      .from(budgetPlans)
      .where(eq(budgetPlans.userId, userId))
      .orderBy(asc(budgetPlans.createdAt)),
    db
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type,
        budgetId: accounts.budgetId,
      })
      .from(accounts)
      .where(eq(accounts.userId, userId))
      .orderBy(asc(accounts.sortOrder), asc(accounts.createdAt)),
  ]);

  const own = plans.map((p) => ({
    id: p.id,
    name: p.name,
    isMain: p.isMain,
    period: p.period,
    periodStartedAt: p.periodStartedAt,
    ownerSharePercent: p.ownerSharePercent,
    sharePercents: parseShares(p.sharePercents),
    sharePercent: p.ownerSharePercent,
    createdAt: p.createdAt,
    role: "owner" as "owner" | "viewer",
    ownerName: null as string | null,
    accounts: memberAccounts
      .filter((a) => a.budgetId === p.id)
      .map(({ id, name, type }) => ({ id, name: name as string | null, type })),
  }));

  // Plans reached through accounts shared with the user — read-only. The
  // plan's other accounts appear by EXISTENCE only: their names are nulled
  // unless that account itself is shared with the user.
  const sharedRows = await db
    .selectDistinct({ plan: budgetPlans, ownerName: user.name })
    .from(accountMembers)
    .innerJoin(accounts, eq(accounts.id, accountMembers.accountId))
    .innerJoin(budgetPlans, eq(budgetPlans.id, accounts.budgetId))
    .innerJoin(user, eq(user.id, budgetPlans.userId))
    .where(activeMembership(userId));
  const accessibleIds = new Set(
    (await db
      .select({ id: accountMembers.accountId })
      .from(accountMembers)
      .where(activeMembership(userId))).map((r) => r.id),
  );
  const shared = await Promise.all(
    sharedRows.map(async ({ plan, ownerName }) => {
      const planAccounts = await db
        .select({ id: accounts.id, name: accounts.name, type: accounts.type })
        .from(accounts)
        .where(and(eq(accounts.userId, plan.userId), eq(accounts.budgetId, plan.id)))
        .orderBy(asc(accounts.sortOrder), asc(accounts.createdAt));
      // Everyone the plan is shared with, so the caller's own percent can fall
      // back to an even slice of the remainder. Their invite address is the
      // key — accepting under a different address must not lose the key.
      const memberRows = await db
        .select({ email: accountMembers.email, userId: accountMembers.userId })
        .from(accountMembers)
        .innerJoin(accounts, eq(accounts.id, accountMembers.accountId))
        .where(
          and(
            eq(accounts.userId, plan.userId),
            eq(accounts.budgetId, plan.id),
            isNull(accountMembers.revokedAt),
          ),
        );
      const emails = [...new Set(memberRows.map((m) => m.email))];
      const myEmail = memberRows.find((m) => m.userId === userId)?.email;
      const resolved = memberSharePercents(
        emails,
        plan.ownerSharePercent,
        parseShares(plan.sharePercents),
      );
      return {
        id: plan.id,
        name: plan.name,
        isMain: false,
        period: plan.period,
        periodStartedAt: plan.periodStartedAt,
        ownerSharePercent: plan.ownerSharePercent,
        // Never the whole key: the other members' addresses are not the
        // caller's to see.
        sharePercents: {} as Record<string, number>,
        sharePercent: myEmail ? (resolved[myEmail] ?? 0) : 100 - plan.ownerSharePercent,
        createdAt: plan.createdAt,
        role: "viewer" as const,
        ownerName,
        accounts: planAccounts.map(({ id, name, type }) => ({
          id,
          name: accessibleIds.has(id) ? name : null,
          type,
        })),
      };
    }),
  );

  return [...own, ...shared];
}

/**
 * Replace a plan's account membership with `accountIds`. Membership is
 * exclusive (accounts.budgetId), so assigning an account silently moves it out
 * of whichever plan held it. Only checking/joint accounts are assignable.
 * Returns an error message, or null on success.
 */
async function setPlanAccounts(
  userId: string,
  planId: string,
  accountIds: string[],
): Promise<string | null> {
  if (accountIds.length > 0) {
    const owned = await db
      .select({ id: accounts.id, type: accounts.type })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), inArray(accounts.id, accountIds)));
    if (owned.length !== accountIds.length) return "Account not found";
    const invalid = owned.find(
      (a) => !(BUDGETABLE_ACCOUNT_TYPES as readonly string[]).includes(a.type),
    );
    if (invalid) return "Only checking and joint accounts can be added to a budget";
  }

  await db.transaction(async (tx) => {
    // Detach accounts that are no longer members…
    await tx
      .update(accounts)
      .set({ budgetId: null, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(accounts.userId, userId),
          eq(accounts.budgetId, planId),
          ...(accountIds.length > 0 ? [notInArray(accounts.id, accountIds)] : []),
        ),
      );
    // …and attach the listed ones (moving them from any other plan).
    if (accountIds.length > 0) {
      await tx
        .update(accounts)
        .set({ budgetId: planId, updatedAt: new Date().toISOString() })
        .where(and(eq(accounts.userId, userId), inArray(accounts.id, accountIds)));
    }
  });
  return null;
}

// GET /api/budget-plans — all plans with their member accounts
export async function GET() {
  return withUser(async (userId) => {
    return NextResponse.json({ plans: await listPlans(userId) });
  }, "Failed to fetch budget plans");
}

// POST /api/budget-plans — create a plan. The user's first plan becomes main.
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { name, accountIds, period, ownerSharePercent, sharePercents } = body as {
      name?: unknown;
      accountIds?: unknown;
      period?: unknown;
      ownerSharePercent?: unknown;
      sharePercents?: unknown;
    };

    if (!validName(name)) {
      return apiError("api.nameRequiredMax", 400, { max: MAX_NAME_LENGTH });
    }
    if (period !== undefined && !isPeriod(period)) {
      return NextResponse.json(
        { error: "period must be 'monthly' or 'yearly'" },
        { status: 400 },
      );
    }
    if (ownerSharePercent !== undefined && !isSharePercent(ownerSharePercent)) {
      return NextResponse.json(
        { error: "ownerSharePercent must be a whole number between 0 and 100" },
        { status: 400 },
      );
    }
    if (sharePercents !== undefined && !isShareMap(sharePercents)) {
      return NextResponse.json(
        { error: "sharePercents must be whole numbers between 0 and 100, keyed by email" },
        { status: 400 },
      );
    }
    if (
      isShareMap(sharePercents) &&
      Object.keys(sharePercents).length > 0 &&
      !shareTotalIs100(isSharePercent(ownerSharePercent) ? ownerSharePercent : 50, sharePercents)
    ) {
      return NextResponse.json({ error: "the cost split must add up to 100%" }, { status: 400 });
    }
    const planPeriod: PlanPeriod = isPeriod(period) ? period : "monthly";
    const ids = Array.isArray(accountIds)
      ? accountIds.filter((v): v is string => typeof v === "string")
      : [];

    // A plan without any budgetable account to draw from can never fill, so
    // creation is blocked until the user has one.
    const [budgetable] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, userId),
          inArray(accounts.type, [...BUDGETABLE_ACCOUNT_TYPES]),
        ),
      )
      .limit(1);
    if (!budgetable) {
      return apiError("api.needAccountForBudget", 400);
    }

    const existing = await db
      .select({ id: budgetPlans.id })
      .from(budgetPlans)
      .where(eq(budgetPlans.userId, userId))
      .limit(1);

    const id = crypto.randomUUID();
    await db.insert(budgetPlans).values({
      id,
      userId,
      name: name.trim(),
      isMain: existing.length === 0,
      period: planPeriod,
      periodStartedAt:
        planPeriod === "yearly" ? await currentMonthStart(userId) : null,
      ...(isSharePercent(ownerSharePercent) ? { ownerSharePercent } : {}),
      ...(isShareMap(sharePercents)
        ? { sharePercents: JSON.stringify(sharePercents) }
        : {}),
    });

    const accountError = await setPlanAccounts(userId, id, ids);
    if (accountError) {
      await db
        .delete(budgetPlans)
        .where(and(eq(budgetPlans.id, id), eq(budgetPlans.userId, userId)));
      return NextResponse.json({ error: accountError }, { status: 400 });
    }

    // The first plan adopts the user's pre-plan allocations. Users created
    // after migration 0009 have no plan, so their budgets carry budget_id
    // NULL — without this they'd vanish the moment a plan exists, since every
    // plan-scoped view filters on budget_id and nothing can reattach them.
    if (existing.length === 0) {
      await db
        .update(budgets)
        .set({ budgetId: id })
        .where(and(eq(budgets.userId, userId), isNull(budgets.budgetId)));
    }

    logDataEvent({
      userId,
      action: "budget_plan_create",
      targetId: id,
      targetType: "budget_plan",
      details: { name: name.trim(), accountIds: ids },
    });
    return NextResponse.json({ success: true, id }, { status: 201 });
  }, "Failed to create budget plan");
}

// PUT /api/budget-plans — update name / account membership / make main
export async function PUT(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { id, name, accountIds, isMain, period, ownerSharePercent, sharePercents } =
      body as {
        id?: unknown;
        name?: unknown;
        accountIds?: unknown;
        isMain?: unknown;
        period?: unknown;
        ownerSharePercent?: unknown;
        sharePercents?: unknown;
      };

    if (typeof id !== "string" || !id) {
      return NextResponse.json({ error: "Plan ID is required" }, { status: 400 });
    }
    const [plan] = await db
      .select()
      .from(budgetPlans)
      .where(and(eq(budgetPlans.id, id), eq(budgetPlans.userId, userId)))
      .limit(1);
    if (!plan) {
      return apiError("api.budgetPlanNotFound", 404);
    }

    if (name !== undefined) {
      if (!validName(name)) {
        return apiError("api.nameLength", 400, { max: MAX_NAME_LENGTH });
      }
      await db
        .update(budgetPlans)
        .set({ name: name.trim(), updatedAt: new Date().toISOString() })
        .where(and(eq(budgetPlans.id, id), eq(budgetPlans.userId, userId)));
    }

    // Only promotion is supported — every user always has exactly one main
    // plan, so "demote" happens implicitly by promoting another.
    if (isMain === true && !plan.isMain) {
      await db.transaction(async (tx) => {
        await tx
          .update(budgetPlans)
          .set({ isMain: false, updatedAt: new Date().toISOString() })
          .where(and(eq(budgetPlans.userId, userId), eq(budgetPlans.isMain, true)));
        await tx
          .update(budgetPlans)
          .set({ isMain: true, updatedAt: new Date().toISOString() })
          .where(and(eq(budgetPlans.id, id), eq(budgetPlans.userId, userId)));
      });
    }

    if (accountIds !== undefined) {
      if (!Array.isArray(accountIds) || accountIds.some((v) => typeof v !== "string")) {
        return NextResponse.json(
          { error: "accountIds must be an array of account ids" },
          { status: 400 },
        );
      }
      const accountError = await setPlanAccounts(userId, id, accountIds);
      if (accountError) {
        return NextResponse.json({ error: accountError }, { status: 400 });
      }
    }

    // The cost-split key. Owner-only by construction: this route never
    // resolves anything but the caller's own plans.
    if (ownerSharePercent !== undefined || sharePercents !== undefined) {
      if (ownerSharePercent !== undefined && !isSharePercent(ownerSharePercent)) {
        return NextResponse.json(
          { error: "ownerSharePercent must be a whole number between 0 and 100" },
          { status: 400 },
        );
      }
      if (sharePercents !== undefined && !isShareMap(sharePercents)) {
        return NextResponse.json(
          { error: "sharePercents must be whole numbers between 0 and 100, keyed by email" },
          { status: 400 },
        );
      }
      const owner = isSharePercent(ownerSharePercent)
        ? ownerSharePercent
        : plan.ownerSharePercent;
      const submitted = isShareMap(sharePercents)
        ? sharePercents
        : parseShares(plan.sharePercents);
      // Narrowed to people the plan is actually shared with BEFORE the total is
      // checked. Unscoped, a key belonging to nobody still counted toward 100,
      // so padding the map with a stray address let a total through that left
      // the real members' shares adding up to less than the whole budget (see
      // memberSharePercents, which only ever reads member keys). Dropping the
      // strays here also stops the stored key accumulating revoked members.
      //
      // Unless there are no members at all: a plan nobody shares shows no key
      // (planIsShared), so a key set ahead of the invites is inert either way,
      // and filtering it to nothing would just discard the owner's answer.
      const memberEmails = new Set(await planMemberEmails(userId, id));
      const members = memberEmails.size
        ? Object.fromEntries(
            Object.entries(submitted).filter(([email]) => memberEmails.has(email)),
          )
        : submitted;
      if (Object.keys(members).length > 0 && !shareTotalIs100(owner, members)) {
        return NextResponse.json({ error: "the cost split must add up to 100%" }, { status: 400 });
      }
      await db
        .update(budgetPlans)
        .set({
          ownerSharePercent: owner,
          ...(sharePercents !== undefined
            ? { sharePercents: JSON.stringify(members) }
            : {}),
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(budgetPlans.id, id), eq(budgetPlans.userId, userId)));
    }

    // Switching between monthly and yearly. Turning yearly on starts the
    // envelope at the current month — earlier months of this year were never
    // budgeted as one pot, so inventing carry-over for them would be fiction.
    // Turning it off throws the ledger away; nothing else reads it.
    if (period !== undefined) {
      if (!isPeriod(period)) {
        return NextResponse.json(
          { error: "period must be 'monthly' or 'yearly'" },
          { status: 400 },
        );
      }
      if (period !== plan.period) {
        await db
          .update(budgetPlans)
          .set({
            period,
            periodStartedAt:
              period === "yearly" ? await currentMonthStart(userId) : null,
            updatedAt: new Date().toISOString(),
          })
          .where(and(eq(budgetPlans.id, id), eq(budgetPlans.userId, userId)));
        if (period === "monthly") await clearLedger(userId, id);
      }
    }

    logDataEvent({
      userId,
      action: "budget_plan_update",
      targetId: id,
      targetType: "budget_plan",
      details: { name, isMain, accountIds, period, ownerSharePercent, sharePercents },
    });

    return NextResponse.json({ success: true });
  }, "Failed to update budget plan");
}

// DELETE /api/budget-plans?id= — delete a plan and its allocations. Deleting
// the main plan promotes the oldest remaining plan so there is always a main.
export async function DELETE(request: NextRequest) {
  return withUser(async (userId) => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Plan ID is required" }, { status: 400 });
    }

    const [plan] = await db
      .select()
      .from(budgetPlans)
      .where(and(eq(budgetPlans.id, id), eq(budgetPlans.userId, userId)))
      .limit(1);
    if (!plan) {
      return apiError("api.budgetPlanNotFound", 404);
    }

    // Explicit cleanup instead of relying on FK cascades — libsql connections
    // don't guarantee foreign_keys=ON.
    await db.transaction(async (tx) => {
      await tx.delete(budgetSubLines).where(
        and(
          eq(budgetSubLines.userId, userId),
          inArray(
            budgetSubLines.allocationId,
            tx
              .select({ id: budgets.id })
              .from(budgets)
              .where(and(eq(budgets.budgetId, id), eq(budgets.userId, userId))),
          ),
        ),
      );
      await tx.delete(budgets).where(and(eq(budgets.budgetId, id), eq(budgets.userId, userId)));
      await tx
        .delete(budgetMonthTargets)
        .where(
          and(
            eq(budgetMonthTargets.budgetId, id),
            eq(budgetMonthTargets.userId, userId),
          ),
        );
      await tx
        .update(accounts)
        .set({ budgetId: null, updatedAt: new Date().toISOString() })
        .where(and(eq(accounts.userId, userId), eq(accounts.budgetId, id)));
      await tx
        .delete(budgetPlans)
        .where(and(eq(budgetPlans.id, id), eq(budgetPlans.userId, userId)));
      if (plan.isMain) {
        const [next] = await tx
          .select({ id: budgetPlans.id })
          .from(budgetPlans)
          .where(eq(budgetPlans.userId, userId))
          .orderBy(asc(budgetPlans.createdAt))
          .limit(1);
        if (next) {
          await tx
            .update(budgetPlans)
            .set({ isMain: true, updatedAt: new Date().toISOString() })
            .where(and(eq(budgetPlans.id, next.id), eq(budgetPlans.userId, userId)));
        }
      }
    });

    logDataEvent({
      userId,
      action: "budget_plan_delete",
      targetId: id,
      targetType: "budget_plan",
      details: { name: plan.name },
    });
    return NextResponse.json({ success: true });
  }, "Failed to delete budget plan");
}
