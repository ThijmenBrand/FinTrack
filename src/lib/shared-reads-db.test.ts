import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("shared-reads");

const { visibleTransactions } = await import("@/lib/account-access");
const { resolveBudgetPlan, resolveMainPlan, effectiveStartDay } = await import(
  "@/lib/budget-plan"
);
const { updateUserPreferences } = await import("@/lib/preferences");
const { getBudgetOverview } = await import("@/app/(app)/_lib/dashboard-queries");
const { getFinancialMonthRange } = await import("@/lib/financial-month");
const { db } = await import("@/db");
const {
  accounts,
  accountMembers,
  budgetPlans,
  budgets,
  categories,
  transactions,
  userPreferences,
} = await import("@/db/schema");
const { eq } = await import("drizzle-orm");

const OWNER = "owner-1";
const MEMBER = "member-1";
const NOW = new Date().toISOString();
let seq = 0;

async function tx(
  userId: string,
  accountId: string,
  amount: number,
  opts: { date?: string; categoryId?: string; type?: "income" | "expense" } = {},
) {
  await db.insert(transactions).values({
    id: `tx-${++seq}`,
    userId,
    accountId,
    date: opts.date ?? NOW.slice(0, 10),
    description: "t",
    amount,
    type: opts.type ?? "expense",
    categoryId: opts.categoryId,
  });
}

beforeEach(async () => {
  await testDb.reset();
  await testDb.client.execute(
    `INSERT INTO "user" (id, name, email) VALUES ('${OWNER}', 'Alice', 'a@example.com'), ('${MEMBER}', 'Bob', 'b@example.com')`,
  );
  await db.insert(budgetPlans).values([
    { id: "plan-shared", userId: OWNER, name: "Household", isMain: true },
    { id: "plan-private", userId: OWNER, name: "Secret", isMain: false },
    { id: "plan-mine", userId: MEMBER, name: "Mine", isMain: true },
  ]);
  await db.insert(accounts).values([
    { id: "acc-shared", userId: OWNER, name: "Joint", type: "joint", budgetId: "plan-shared" },
    // In the shared plan but not individually shared — existence only.
    { id: "acc-owner2", userId: OWNER, name: "Owner checking", type: "checking", budgetId: "plan-shared" },
    { id: "acc-private", userId: OWNER, name: "Private", type: "checking" },
    { id: "acc-mine", userId: MEMBER, name: "Bob checking", type: "checking" },
  ]);
  await db.insert(accountMembers).values({
    id: "m-1",
    accountId: "acc-shared",
    userId: MEMBER,
    email: "b@example.com",
    role: "viewer",
    acceptedAt: NOW,
  });
  await db.insert(categories).values({ id: "c-own", userId: OWNER, name: "Groceries" });
  // Owner's financial month starts on the 15th; the member's on the 1st.
  await db.insert(userPreferences).values([
    { id: "p-o", userId: OWNER, financialMonthStartDay: 15, createdAt: NOW, updatedAt: NOW },
    {
      id: "p-m",
      userId: MEMBER,
      financialMonthStartDay: 1,
      mainBudgetPlanId: "plan-shared",
      createdAt: NOW,
      updatedAt: NOW,
    },
  ]);
});
afterAll(() => testDb.cleanup());

describe("visibleTransactions", () => {
  it("member sees own rows and shared-account rows with owner category labels, not private rows", async () => {
    await tx(OWNER, "acc-shared", -10, { categoryId: "c-own" });
    await tx(OWNER, "acc-private", -20);
    await tx(MEMBER, "acc-mine", -30);

    const rows = await db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        categoryName: categories.name,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(visibleTransactions(MEMBER));

    expect(rows.map((r) => r.accountId).sort()).toEqual(["acc-mine", "acc-shared"]);
    // Owner's category label resolves for the shared row (join by id).
    expect(rows.find((r) => r.accountId === "acc-shared")?.categoryName).toBe("Groceries");
  });

  it("pending and revoked memberships see nothing shared", async () => {
    await tx(OWNER, "acc-shared", -10);
    await testDb.client.execute(`UPDATE account_members SET accepted_at = NULL WHERE id = 'm-1'`);
    expect(await db.select().from(transactions).where(visibleTransactions(MEMBER))).toHaveLength(0);
    await testDb.client.execute(
      `UPDATE account_members SET accepted_at = '${NOW}', revoked_at = '${NOW}' WHERE id = 'm-1'`,
    );
    expect(await db.select().from(transactions).where(visibleTransactions(MEMBER))).toHaveLength(0);
  });
});

describe("resolveBudgetPlan / resolveMainPlan", () => {
  it("member resolves a shared plan read-only with the owner's accounts", async () => {
    const plan = await resolveBudgetPlan(MEMBER, "plan-shared");
    expect(plan).toMatchObject({
      id: "plan-shared",
      ownerId: OWNER,
      role: "viewer",
      ownerName: "Alice",
    });
    expect(plan!.accountIds.sort()).toEqual(["acc-owner2", "acc-shared"]);
  });

  it("does not resolve the owner's unshared plan", async () => {
    expect(await resolveBudgetPlan(MEMBER, "plan-private")).toBeNull();
  });

  it("resolveMainPlan follows mainBudgetPlanId and falls back to the own main plan", async () => {
    expect((await resolveMainPlan(MEMBER))?.id).toBe("plan-shared");
    // Revoked share → chosen plan no longer resolves → own main plan.
    await testDb.client.execute(
      `UPDATE account_members SET revoked_at = '${NOW}' WHERE id = 'm-1'`,
    );
    expect((await resolveMainPlan(MEMBER))?.id).toBe("plan-mine");
  });

  it("preferences accept an accessible plan and reject a foreign unshared one", async () => {
    // Mirrors PUT /api/preferences validation: resolveBudgetPlan null ⇒ 400.
    expect(await resolveBudgetPlan(MEMBER, "plan-private")).toBeNull();
    const prefs = await updateUserPreferences(MEMBER, { mainBudgetPlanId: null });
    expect(prefs.mainBudgetPlanId).toBeNull();
    const prefs2 = await updateUserPreferences(MEMBER, { mainBudgetPlanId: "plan-shared" });
    expect(prefs2.mainBudgetPlanId).toBe("plan-shared");
  });
});

describe("shared plan uses the OWNER's financial month", () => {
  it("effectiveStartDay returns the owner's start day for foreign plans only", async () => {
    const plan = await resolveBudgetPlan(MEMBER, "plan-shared");
    expect(await effectiveStartDay(MEMBER, plan, 1)).toBe(15);
    expect(await effectiveStartDay(OWNER, plan, 15)).toBe(15);
    expect(await effectiveStartDay(MEMBER, null, 1)).toBe(1);
  });

  it("getBudgetOverview sums the owner's window, not the member's", async () => {
    await db.insert(budgets).values({
      id: "b-1",
      userId: OWNER,
      budgetId: "plan-shared",
      categoryId: "c-own",
      amount: 500,
      period: "monthly",
      isActive: true,
      status: "active",
    });

    const now = new Date();
    const ownerRange = getFinancialMonthRange(now, 15);
    const memberRange = getFinancialMonthRange(now, 1);
    // A date inside the owner's financial month but outside the member's
    // calendar month — the two windows always differ on one edge.
    const ownerOnlyDate =
      ownerRange.from < memberRange.from ? ownerRange.from : ownerRange.to;
    expect(ownerOnlyDate < memberRange.from || ownerOnlyDate > memberRange.to).toBe(true);

    await tx(OWNER, "acc-shared", -50, { date: ownerOnlyDate, categoryId: "c-own" });
    await tx(OWNER, "acc-shared", -20, {
      date: now.toISOString().slice(0, 10),
      categoryId: "c-own",
    });

    // Member passes their own startDay (1); the overview must override it with
    // the owner's (15) and count both expenses.
    const overview = await getBudgetOverview(MEMBER, 1, "plan-shared");
    expect(overview.plan).toMatchObject({ id: "plan-shared", role: "viewer", ownerName: "Alice" });
    expect(overview.totalBudgetSpent).toBe(70);
    expect(overview.budgetItems[0]).toMatchObject({ categoryId: "c-own", spent: 70 });
  });
});
