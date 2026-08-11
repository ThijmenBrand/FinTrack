import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  accounts,
  budgetLedger,
  budgetLedgerJobs,
  budgetPlans,
  budgets,
} from "@/db/schema";
import { eq, and, asc, inArray, isNull, notInArray } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { logDataEvent } from "@/lib/audit";
import { BUDGETABLE_ACCOUNT_TYPES } from "@/lib/account-scope";
import { getUserPreferences } from "@/lib/preferences";
import { getFinancialMonthRange } from "@/lib/financial-month";
import { touchAllLedgers } from "@/lib/budget-jobs";
import { clearLedger } from "@/lib/budget-ledger-db";

const MAX_NAME_LENGTH = 60;
const PERIODS = ["monthly", "yearly"] as const;
type PlanPeriod = (typeof PERIODS)[number];

function validName(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.trim().length <= MAX_NAME_LENGTH;
}

function isPeriod(v: unknown): v is PlanPeriod {
  return typeof v === "string" && (PERIODS as readonly string[]).includes(v);
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

  return plans.map((p) => ({
    id: p.id,
    name: p.name,
    isMain: p.isMain,
    period: p.period,
    periodStartedAt: p.periodStartedAt,
    createdAt: p.createdAt,
    accounts: memberAccounts
      .filter((a) => a.budgetId === p.id)
      .map(({ id, name, type }) => ({ id, name, type })),
  }));
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
    const { name, accountIds, period } = body as {
      name?: unknown;
      accountIds?: unknown;
      period?: unknown;
    };

    if (!validName(name)) {
      return NextResponse.json(
        { error: `Name is required (max ${MAX_NAME_LENGTH} characters)` },
        { status: 400 },
      );
    }
    if (period !== undefined && !isPeriod(period)) {
      return NextResponse.json(
        { error: "period must be 'monthly' or 'yearly'" },
        { status: 400 },
      );
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
      return NextResponse.json(
        { error: "Add a checking or joint account before creating a budget" },
        { status: 400 },
      );
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
    });

    const accountError = await setPlanAccounts(userId, id, ids);
    if (accountError) {
      await db.delete(budgetPlans).where(eq(budgetPlans.id, id));
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
    const { id, name, accountIds, isMain, period } = body as {
      id?: unknown;
      name?: unknown;
      accountIds?: unknown;
      isMain?: unknown;
      period?: unknown;
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
      return NextResponse.json({ error: "Budget plan not found" }, { status: 404 });
    }

    if (name !== undefined) {
      if (!validName(name)) {
        return NextResponse.json(
          { error: `Name must be 1–${MAX_NAME_LENGTH} characters` },
          { status: 400 },
        );
      }
      await db
        .update(budgetPlans)
        .set({ name: name.trim(), updatedAt: new Date().toISOString() })
        .where(eq(budgetPlans.id, id));
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
          .where(eq(budgetPlans.id, id));
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
      details: { name, isMain, accountIds, period },
    });

    // Account membership and the period both change what the envelope counts,
    // so the ledger is rebuilt — in the background, after this response.
    if (accountIds !== undefined || period !== undefined) {
      await touchAllLedgers(userId);
    }

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
      return NextResponse.json({ error: "Budget plan not found" }, { status: 404 });
    }

    // Explicit cleanup instead of relying on FK cascades — libsql connections
    // don't guarantee foreign_keys=ON.
    await db.transaction(async (tx) => {
      await tx.delete(budgets).where(and(eq(budgets.budgetId, id), eq(budgets.userId, userId)));
      await tx
        .delete(budgetLedger)
        .where(and(eq(budgetLedger.budgetId, id), eq(budgetLedger.userId, userId)));
      await tx
        .delete(budgetLedgerJobs)
        .where(
          and(eq(budgetLedgerJobs.budgetId, id), eq(budgetLedgerJobs.userId, userId)),
        );
      await tx
        .update(accounts)
        .set({ budgetId: null, updatedAt: new Date().toISOString() })
        .where(and(eq(accounts.userId, userId), eq(accounts.budgetId, id)));
      await tx.delete(budgetPlans).where(eq(budgetPlans.id, id));
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
            .where(eq(budgetPlans.id, next.id));
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
