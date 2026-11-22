/**
 * The investments dashboard card's query.
 *
 * Two numbers from two different places meet here. Value is typed in by hand
 * and is only as true as its date; "put in" is the ledger's own answer, taken
 * from the `internal_transfer` legs that landed in these accounts. The gap
 * between them is the return, which is why neither may quietly borrow from
 * the other — a value with no contributions behind it would read as pure
 * profit, and a contribution total that counted ordinary spending would eat
 * the gain.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { setupTestDb } from "./test-db";

const testDb = await setupTestDb("dashboard-investments");

const { getInvestmentSummary } = await import("@/app/(app)/_lib/dashboard-queries");

const ME = "inv-me";
const OTHER = "inv-other";
const NOW = new Date().toISOString();
const THIS_YEAR = new Date().getFullYear();
const TODAY = NOW.slice(0, 10);
let seq = 0;

afterAll(() => testDb.cleanup());

beforeEach(async () => {
  await testDb.reset();
  for (const id of [ME, OTHER]) {
    await testDb.client.execute({
      sql: `INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)`,
      args: [id, id, `${id}@test.dev`],
    });
  }
  await testDb.client.execute({
    sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, created_at, updated_at)
          VALUES ('acc-cash', ?, 'Main', 'checking', 'EUR', 500, 0, ?, ?)`,
    args: [ME, NOW, NOW],
  });
});

async function broker(
  id: string,
  opts: { value?: number | null; valuedAt?: string | null; userId?: string } = {},
) {
  await testDb.client.execute({
    sql: `INSERT INTO accounts
            (id, user_id, name, type, currency, initial_balance, current_value, valued_at, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, 'investment', 'EUR', 0, ?, ?, 0, ?, ?)`,
    args: [
      id,
      opts.userId ?? ME,
      id,
      opts.value ?? null,
      opts.valuedAt ?? null,
      NOW,
      NOW,
    ],
  });
}

/** A leg landing in an account. `type` decides whether it counts as put-in. */
async function leg(
  accountId: string,
  amount: number,
  date: string,
  type = "internal_transfer",
  userId = ME,
) {
  await testDb.client.execute({
    sql: `INSERT INTO transactions
            (id, user_id, account_id, date, description, amount, type, created_at)
          VALUES (?, ?, ?, ?, 'Leg', ?, ?, ?)`,
    args: [`tx-${seq++}`, userId, accountId, date, amount, type, NOW],
  });
}

describe("getInvestmentSummary", () => {
  it("is null when there are no investment accounts", async () => {
    expect(await getInvestmentSummary(ME)).toBeNull();
  });

  it("adds up valuations and the deposits behind them", async () => {
    await broker("acc-degiro", { value: 32_480, valuedAt: TODAY });
    await leg("acc-degiro", 20_000, `${THIS_YEAR}-03-01`);
    await leg("acc-degiro", 8_000, `${THIS_YEAR}-09-01`);

    const s = (await getInvestmentSummary(ME))!;
    expect(s.totalValue).toBe(32_480);
    expect(s.totalContributed).toBe(28_000);
    expect(s.accounts).toHaveLength(1);
    expect(s.accounts[0].contributed).toBe(28_000);
  });

  it("nets a withdrawal off what was put in", async () => {
    await broker("acc-degiro", { value: 9_000, valuedAt: TODAY });
    await leg("acc-degiro", 10_000, `${THIS_YEAR}-03-01`);
    await leg("acc-degiro", -2_000, `${THIS_YEAR}-06-01`);

    const s = (await getInvestmentSummary(ME))!;
    expect(s.totalContributed).toBe(8_000);
  });

  it("counts only transfer legs, not spending booked on the account", async () => {
    await broker("acc-degiro", { value: 1_000, valuedAt: TODAY });
    await leg("acc-degiro", 1_000, `${THIS_YEAR}-03-01`);
    await leg("acc-degiro", -40, `${THIS_YEAR}-04-01`, "expense");

    const s = (await getInvestmentSummary(ME))!;
    expect(s.totalContributed).toBe(1_000);
  });

  it("windows this year's deposits without touching the lifetime total", async () => {
    await broker("acc-degiro", { value: 32_480, valuedAt: TODAY });
    await leg("acc-degiro", 20_000, `${THIS_YEAR - 1}-03-01`);
    await leg("acc-degiro", 8_000, `${THIS_YEAR}-09-01`);

    const s = (await getInvestmentSummary(ME))!;
    expect(s.totalContributed).toBe(28_000);
    expect(s.investedThisYear).toBe(8_000);
  });

  it("leaves cash accounts out entirely", async () => {
    await broker("acc-degiro", { value: 1_000, valuedAt: TODAY });
    await leg("acc-cash", 5_000, `${THIS_YEAR}-03-01`);

    const s = (await getInvestmentSummary(ME))!;
    expect(s.accounts.map((a) => a.id)).toEqual(["acc-degiro"]);
    expect(s.totalContributed).toBe(0);
  });

  it("never reaches into another user's accounts", async () => {
    await broker("acc-theirs", { value: 99_999, valuedAt: TODAY, userId: OTHER });
    await broker("acc-mine", { value: 1_000, valuedAt: TODAY });

    const s = (await getInvestmentSummary(ME))!;
    expect(s.accounts.map((a) => a.id)).toEqual(["acc-mine"]);
    expect(s.totalValue).toBe(1_000);
  });

  it("treats a never-valued account as nothing, not as zero euros of worth", async () => {
    await broker("acc-degiro", { value: null, valuedAt: null });
    await leg("acc-degiro", 500, `${THIS_YEAR}-03-01`);

    const s = (await getInvestmentSummary(ME))!;
    expect(s.totalValue).toBe(0);
    expect(s.accounts[0].currentValue).toBeNull();
    expect(s.stale).toBe(true);
    expect(s.valuedAt).toBeNull();
  });

  it("wears the oldest valuation date, so one fresh account cannot vouch for a stale one", async () => {
    await broker("acc-new", { value: 1_000, valuedAt: TODAY });
    await broker("acc-old", { value: 2_000, valuedAt: `${THIS_YEAR - 1}-01-15` });

    const s = (await getInvestmentSummary(ME))!;
    expect(s.valuedAt).toBe(`${THIS_YEAR - 1}-01-15`);
    expect(s.stale).toBe(true);
  });

  it("is not stale when every account was valued today", async () => {
    await broker("acc-a", { value: 1_000, valuedAt: TODAY });
    await broker("acc-b", { value: 2_000, valuedAt: TODAY });

    const s = (await getInvestmentSummary(ME))!;
    expect(s.valuedAt).toBe(TODAY);
    expect(s.stale).toBe(false);
    expect(s.totalValue).toBe(3_000);
  });
});
