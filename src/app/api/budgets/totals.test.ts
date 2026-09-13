/**
 * `GET /api/budgets` headline arithmetic.
 *
 * The page draws its own header by summing the rows (see `ownFixed` in
 * budgets/page.tsx and `lockedExpenses` in budgets/edit/page.tsx), so these
 * payload fields have to follow the same rule or the two disagree the moment
 * a category carries both an allocation and the bills that allocation covers.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const USER = "budget-totals-user";
const OTHER = "budget-totals-other";

let actor = USER;
vi.mock("@/lib/auth", () => ({
  withUser: async (handler: (userId: string) => Promise<Response>) => {
    try {
      return await handler(actor);
    } catch (e) {
      if (e instanceof Response) return e;
      throw e;
    }
  },
}));

let testDb: TestDb;
const NOW = new Date().toISOString();
const TODAY = NOW.slice(0, 10);
const YEAR = TODAY.slice(0, 4);

beforeAll(async () => {
  testDb = await setupTestDb("budget-totals");
});
afterAll(() => testDb.cleanup());

beforeEach(async () => {
  actor = USER;
  await testDb.reset();
  for (const id of [USER, OTHER]) {
    await testDb.client.execute({
      sql: `INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)`,
      args: [id, id, `${id}@test.dev`],
    });
  }
  await testDb.client.execute({
    sql: `INSERT INTO budget_plans (id, user_id, name, is_main, created_at, updated_at)
          VALUES ('plan-1', ?, 'Main', 1, ?, ?)`,
    args: [USER, NOW, NOW],
  });
  await testDb.client.execute({
    sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, budget_id, created_at, updated_at)
          VALUES ('acc-1', ?, 'Main', 'checking', 'EUR', 0, 0, 'plan-1', ?, ?)`,
    args: [USER, NOW, NOW],
  });
  for (const [id, name] of [
    ["cat-rent", "Rent"],
    ["cat-food", "Food"],
    ["cat-salary", "Salary"],
  ]) {
    await testDb.client.execute({
      sql: `INSERT INTO categories (id, user_id, name, created_at) VALUES (?, ?, ?, ?)`,
      args: [id, USER, name, NOW],
    });
  }
});

type Payload = {
  monthlyIncome: number;
  totalFixedCosts: number;
  availableToAllocate: number;
  totalAllocated: number;
  unallocated: number;
  totalBudget: number;
  totalSpentThisMonth: number;
  allocations: { categoryId: string; amount: number; spent: number; percentage: number; status: string }[];
  fixedCosts: { categoryId: string; monthlyAmount: number; spent: number }[];
  incomeLines: { categoryId: string; expected: number; received: number }[];
  unbudgetedSpending: { categoryId: string; spent: number }[];
};

async function get(query = ""): Promise<Payload> {
  const { GET } = await import("./route");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await GET(new Request(`http://x/api/budgets${query}`) as any);
  expect(res.status).toBe(200);
  return res.json();
}

const recurring = (
  id: string,
  amount: number,
  opts: {
    categoryId?: string | null;
    type?: "income" | "expense";
    frequency?: string;
    accountId?: string;
  } = {},
) =>
  testDb.client.execute({
    sql: `INSERT INTO recurring_transactions
            (id, user_id, account_id, description, amount, type, category_id, frequency, start_date, is_active, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    args: [
      id,
      USER,
      opts.accountId ?? "acc-1",
      id,
      amount,
      opts.type ?? "expense",
      opts.categoryId ?? null,
      opts.frequency ?? "monthly",
      `${YEAR}-01-01`,
      NOW,
    ],
  });

const allocation = (id: string, categoryId: string, amount: number) =>
  testDb.client.execute({
    sql: `INSERT INTO budgets (id, user_id, budget_id, category_id, amount, period, is_active, status, source, created_at)
          VALUES (?, ?, 'plan-1', ?, ?, 'monthly', 1, 'active', 'manual', ?)`,
    args: [id, USER, categoryId, amount, NOW],
  });

let txSeq = 0;
const tx = (
  amount: number,
  type: "income" | "expense",
  categoryId: string | null = null,
  date = TODAY,
) =>
  testDb.client.execute({
    sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, category_id, created_at)
          VALUES (?, ?, 'acc-1', ?, 't', ?, ?, ?, ?)`,
    args: [`tx-${++txSeq}`, USER, date, amount, type, categoryId, NOW],
  });

describe("GET /api/budgets — totals", () => {
  it("counts a bill its category's allocation already covers exactly once", async () => {
    await recurring("rec-rent", -1000, { categoryId: "cat-rent" });
    await allocation("b-rent", "cat-rent", 1000);
    await recurring("rec-salary", 3000, {
      categoryId: "cat-salary",
      type: "income",
    });

    const data = await get();

    // The bill is still reported as a bill…
    expect(data.totalFixedCosts).toBe(1000);
    // …but the budget is 1.000, not 1.000 + 1.000.
    expect(data.totalBudget).toBe(1000);
    expect(data.availableToAllocate).toBe(3000);
    expect(data.unallocated).toBe(2000);
  });

  it("keeps counting a bill whose category has no allocation", async () => {
    await recurring("rec-rent", -1000, { categoryId: "cat-rent" });
    await allocation("b-food", "cat-food", 400);
    await recurring("rec-salary", 3000, {
      categoryId: "cat-salary",
      type: "income",
    });

    const data = await get();

    expect(data.totalBudget).toBe(1400);
    expect(data.availableToAllocate).toBe(2000);
    expect(data.unallocated).toBe(1600);
  });

  it("keeps a bill with no category in the totals — it is nobody's allocation", async () => {
    await recurring("rec-loose", -120, { categoryId: null });
    await recurring("rec-salary", 1000, { type: "income" });

    const data = await get();

    expect(data.totalFixedCosts).toBe(120);
    expect(data.totalBudget).toBe(120);
    expect(data.availableToAllocate).toBe(880);
  });

  it("totalBudget equals the rows the page actually draws", async () => {
    await recurring("rec-rent", -1000, { categoryId: "cat-rent" });
    await recurring("rec-fun", -60, { categoryId: "cat-food" });
    await allocation("b-rent", "cat-rent", 1200);

    const data = await get();

    const allocatedIds = new Set(data.allocations.map((a) => a.categoryId));
    const ownFixed = data.fixedCosts
      .filter((fc) => !allocatedIds.has(fc.categoryId))
      .reduce((s, fc) => s + fc.monthlyAmount, 0);
    const allocated = data.allocations.reduce((s, a) => s + a.amount, 0);

    expect(data.totalBudget).toBeCloseTo(ownFixed + allocated, 6);
    expect(data.totalBudget).toBe(1260);
  });

  it("scales income, bills, allocations and the headroom between them alike", async () => {
    await recurring("rec-rent", -1000, { categoryId: "cat-rent" });
    await recurring("rec-salary", 3000, { type: "income" });
    await allocation("b-food", "cat-food", 500);

    // A 3-month range without noScale: every monthly figure is pro-rated.
    const data = await get(`?dateFrom=${YEAR}-01-01&dateTo=${YEAR}-03-31`);
    const scale = data.totalAllocated / 500;

    expect(scale).toBeGreaterThan(2.9);
    expect(data.monthlyIncome).toBeCloseTo(3000 * scale, 1);
    expect(data.availableToAllocate).toBeCloseTo((3000 - 1000) * scale, 1);
    expect(data.unallocated).toBeCloseTo(
      data.availableToAllocate - data.totalAllocated,
      6,
    );
    expect(data.totalBudget).toBeCloseTo((1000 + 500) * scale, 1);
  });

  it("reports spend against a zero allocation as exceeded", async () => {
    await allocation("b-food", "cat-food", 0);
    await tx(-25, "expense", "cat-food");

    const data = await get();

    expect(data.allocations[0]).toMatchObject({
      amount: 0,
      spent: 25,
      percentage: 100,
      status: "exceeded",
    });
  });

  it("leaves a zero allocation with no spend at ok", async () => {
    await allocation("b-food", "cat-food", 0);

    const data = await get();

    expect(data.allocations[0]).toMatchObject({ percentage: 0, status: "ok" });
  });

  it("totalSpentThisMonth covers every euro the month saw, budgeted or not", async () => {
    await allocation("b-food", "cat-food", 400);
    await tx(-100, "expense", "cat-food");
    await tx(-30, "expense", "cat-rent"); // unbudgeted
    await tx(-7, "expense", null); // uncategorized

    const data = await get();

    expect(data.totalSpentThisMonth).toBe(137);
    expect(data.unbudgetedSpending.reduce((s, r) => s + r.spent, 0)).toBe(37);
  });

  it("reports income that arrived with no plan behind it as an unplanned line", async () => {
    await recurring("rec-salary", 2000, {
      categoryId: "cat-salary",
      type: "income",
    });
    await tx(2000, "income", "cat-salary");
    await tx(150, "income", "cat-food"); // a refund booked as income

    const data = await get();

    const salary = data.incomeLines.find((l) => l.categoryId === "cat-salary")!;
    expect(salary).toMatchObject({ expected: 2000, received: 2000 });
    const stray = data.incomeLines.find((l) => l.categoryId === "cat-food")!;
    expect(stray).toMatchObject({ expected: 0, received: 150 });
  });

  it("sees nothing of another user's plan", async () => {
    actor = OTHER;
    await recurring("rec-rent", -1000, { categoryId: "cat-rent" });
    await allocation("b-rent", "cat-rent", 1000);

    const data = await get();

    expect(data.totalBudget).toBe(0);
    expect(data.allocations).toEqual([]);
    expect(data.fixedCosts).toEqual([]);
  });
});
