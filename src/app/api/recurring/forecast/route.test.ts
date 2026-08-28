import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const USER = "forecast-user";

vi.mock("@/lib/auth", () => ({
  withUser: (handler: (userId: string) => Promise<Response>) => handler(USER),
}));

let testDb: TestDb;

beforeAll(async () => {
  testDb = await setupTestDb("recurring-forecast");
});
afterAll(async () => {
  await testDb.cleanup();
});
beforeEach(async () => {
  await testDb.reset();
  await testDb.client.execute({
    sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    args: [USER, USER, `${USER}@test.dev`, Date.now(), Date.now()],
  });
  const now = new Date().toISOString();
  await testDb.client.execute({
    sql: `INSERT INTO accounts (id, user_id, name, type, created_at, updated_at) VALUES ('acc-1', ?, 'Checking', 'checking', ?, ?)`,
    args: [USER, now, now],
  });
  for (const [id, name, kind] of [
    ["cat-salary", "Salary", "income"],
    ["cat-bills", "Bills", "expense"],
    ["cat-move", "Internal Transfer", "transfer"],
  ]) {
    await testDb.client.execute({
      sql: `INSERT INTO categories (id, user_id, name, kind, created_at) VALUES (?, ?, ?, ?, ?)`,
      args: [id, USER, name, kind, now],
    });
  }
});

async function makeRecurring(
  id: string,
  amount: number,
  type: "income" | "expense",
  categoryId: string,
) {
  await testDb.client.execute({
    sql: `INSERT INTO recurring_transactions (id, user_id, account_id, description, amount, type, category_id, frequency, day_of_month, start_date, created_at)
          VALUES (?, ?, 'acc-1', ?, ?, ?, ?, 'monthly', 15, '2020-01-01', ?)`,
    args: [id, USER, id, amount, type, categoryId, new Date().toISOString()],
  });
}

const forecast = () =>
  import("./route")
    .then(({ GET }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      GET(new Request("http://x/api/recurring/forecast?months=3") as any),
    )
    .then((res) => res.json());

describe("GET /api/recurring/forecast", () => {
  it("leaves transfers between your own accounts out of both totals", async () => {
    // The shape that broke this: one move to a joint account shows up as an
    // expense on the paying side and as part of the deposit on the receiving
    // one, so both gross figures — and the savings rate read off them —
    // counted money that never entered or left.
    await makeRecurring("salary", 2000, "income", "cat-salary");
    await makeRecurring("bills", 100, "expense", "cat-bills");
    await makeRecurring("to-joint", 900, "expense", "cat-move");
    await makeRecurring("joint-deposit", 900, "income", "cat-move");

    const body = await forecast();

    expect(body.monthlyRecurringIncome).toBe(2000);
    expect(body.monthlyRecurringExpenses).toBe(100);
    expect(body.monthlyNet).toBe(1900);
  });

  it("still lists a transfer under upcoming payments", async () => {
    await makeRecurring("to-joint", 900, "expense", "cat-move");

    const body = await forecast();

    expect(body.upcomingPayments.map((p: { description: string }) => p.description)).toContain(
      "to-joint",
    );
    // ...and the projected balance stays put: the money only changed accounts.
    expect(body.monthlyForecast.every((m: { net: number }) => m.net === 0)).toBe(true);
  });
});
