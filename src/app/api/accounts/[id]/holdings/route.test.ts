/**
 * The holdings endpoint, and the join between phase two and phase three.
 *
 * The load-bearing claim: an account with holdings stops being valued by hand
 * and starts being valued from quantity x price — but it writes those figures
 * into `asset_valuations` exactly as a person would, so the chart, net worth
 * and every balance keep reading one interface and never learn holdings exist.
 *
 * So these tests check the valuation rows as much as the positions, including
 * that entering a year of statements backfills a year of history rather than
 * one point at today, and that deleting a trade rewrites everything after it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const USER = "hold-user";
const OTHER = "hold-other";
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

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  testDb = await setupTestDb("holdings-route");
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
    sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, created_at, updated_at)
          VALUES ('broker', ?, 'Broker', 'investment', 'EUR', 0, 0, ?, ?),
                 ('broker2', ?, 'Broker 2', 'investment', 'EUR', 0, 1, ?, ?),
                 ('cash', ?, 'Main', 'checking', 'EUR', 0, 2, ?, ?)`,
    args: [USER, NOW, NOW, USER, NOW, NOW, USER, NOW, NOW],
  });
});

interface HoldingRow {
  instrumentId: string;
  quantity: number;
  costBasis: number;
  averagePrice: number | null;
  realized: number;
  marketValue: number | null;
  totalReturn: number | null;
  instrument: { id: string; name: string; isin: string | null; assetClass: string };
}

async function trade(accountId: string, body: Record<string, unknown>) {
  const { POST } = await import("./route");
  const res = await POST(
    new Request("http://t", { method: "POST", body: JSON.stringify(body) }) as never,
    { params: Promise.resolve({ id: accountId }) },
  );
  return { status: res.status, body: (await res.json()) as HoldingRow[] };
}

async function price(accountId: string, body: Record<string, unknown>) {
  const { PUT } = await import("./route");
  const res = await PUT(
    new Request("http://t", { method: "PUT", body: JSON.stringify(body) }) as never,
    { params: Promise.resolve({ id: accountId }) },
  );
  return { status: res.status, body: (await res.json()) as HoldingRow[] };
}

async function holdings(accountId: string) {
  const { GET } = await import("./route");
  const res = await GET(new Request("http://t") as never, {
    params: Promise.resolve({ id: accountId }),
  });
  return { status: res.status, body: (await res.json()) as HoldingRow[] };
}

async function valuations(accountId = "broker") {
  const r = await testDb.client.execute({
    sql: `SELECT date, value, source FROM asset_valuations WHERE account_id = ? ORDER BY date`,
    args: [accountId],
  });
  return r.rows.map((row) => ({
    date: row.date as string,
    value: row.value as number,
    source: row.source as string,
  }));
}

async function accountValue(accountId = "broker") {
  const r = await testDb.client.execute({
    sql: `SELECT current_value, valued_at FROM accounts WHERE id = ?`,
    args: [accountId],
  });
  const row = r.rows[0] as Record<string, unknown>;
  return { value: row.current_value as number | null, date: row.valued_at as string | null };
}

const ETF = { name: "iShares Core MSCI World", isin: "IE00B4L5Y983", assetClass: "equity" };

describe("recording a trade", () => {
  it("creates the instrument and derives the position", async () => {
    const res = await trade("broker", {
      instrument: ETF,
      type: "buy",
      date: "2026-01-05",
      quantity: 10,
      unitPrice: 100,
      fee: 2,
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].quantity).toBe(10);
    expect(res.body[0].costBasis).toBe(1_002);
    expect(res.body[0].instrument.isin).toBe("IE00B4L5Y983");
  });

  it("reuses an instrument on a second buy", async () => {
    const first = await trade("broker", {
      instrument: ETF,
      type: "buy",
      date: "2026-01-05",
      quantity: 10,
      unitPrice: 100,
    });
    const id = first.body[0].instrument.id;

    const second = await trade("broker", {
      instrumentId: id,
      type: "buy",
      date: "2026-02-05",
      quantity: 10,
      unitPrice: 120,
    });
    expect(second.body).toHaveLength(1);
    expect(second.body[0].quantity).toBe(20);
    expect(second.body[0].averagePrice).toBe(110);
  });

  it("leaves the account unvalued until something is priced", async () => {
    await trade("broker", {
      instrument: ETF,
      type: "buy",
      date: "2026-01-05",
      quantity: 10,
      unitPrice: 100,
    });
    // A holding nobody has priced is an unknown, not a zero.
    expect(await valuations()).toEqual([]);
    expect(await accountValue()).toEqual({ value: null, date: null });
  });

  it("refuses a trade dated in the future", async () => {
    const res = await trade("broker", {
      instrument: ETF,
      type: "buy",
      date: tomorrow(),
      quantity: 1,
      unitPrice: 100,
    });
    expect(res.status).toBe(400);
  });

  it("refuses a buy with no quantity, and a fee with no fee", async () => {
    expect(
      (await trade("broker", { instrument: ETF, type: "buy", date: TODAY, unitPrice: 100 }))
        .status,
    ).toBe(400);
    expect(
      (await trade("broker", { instrument: ETF, type: "fee", date: TODAY })).status,
    ).toBe(400);
  });

  it("refuses a negative quantity instead of reading it as a sale", async () => {
    const res = await trade("broker", {
      instrument: ETF,
      type: "buy",
      date: TODAY,
      quantity: -5,
      unitPrice: 100,
    });
    expect(res.status).toBe(400);
  });

  it("refuses a malformed ISIN", async () => {
    const res = await trade("broker", {
      instrument: { ...ETF, isin: "NOPE" },
      type: "buy",
      date: TODAY,
      quantity: 1,
      unitPrice: 100,
    });
    expect(res.status).toBe(400);
  });

  it("refuses an account that holds no investments", async () => {
    const res = await trade("cash", {
      instrument: ETF,
      type: "buy",
      date: TODAY,
      quantity: 1,
      unitPrice: 100,
    });
    expect(res.status).toBe(400);
  });

  it("will not borrow another account's instrument", async () => {
    const mine = await trade("broker", {
      instrument: ETF,
      type: "buy",
      date: "2026-01-05",
      quantity: 1,
      unitPrice: 100,
    });
    const id = mine.body[0].instrument.id;

    await testDb.client.execute({
      sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, created_at, updated_at)
            VALUES ('theirs', ?, 'Theirs', 'investment', 'EUR', 0, 0, ?, ?)`,
      args: [OTHER, NOW, NOW],
    });
    actor = OTHER;
    const res = await trade("theirs", {
      instrumentId: id,
      type: "buy",
      date: TODAY,
      quantity: 1,
      unitPrice: 100,
    });
    expect(res.status).toBe(404);
  });
});

describe("pricing", () => {
  async function seeded() {
    const res = await trade("broker", {
      instrument: ETF,
      type: "buy",
      date: "2026-01-05",
      quantity: 10,
      unitPrice: 100,
    });
    return res.body[0].instrument.id;
  }

  it("values the account and writes the figure into the valuation history", async () => {
    const id = await seeded();
    const res = await price("broker", { instrumentId: id, date: "2026-01-31", price: 110 });

    expect(res.status).toBe(200);
    expect(res.body[0].marketValue).toBe(1_100);
    const rows = await valuations();
    expect(rows.find((r) => r.date === "2026-01-31")).toMatchObject({
      value: 1_100,
      source: "price",
    });
    // And carried forward to today, so the account has a current figure.
    expect((await accountValue()).value).toBe(1_100);
    expect((await accountValue()).date).toBe(TODAY);
  });

  it("backfills a point per event rather than one at today", async () => {
    const id = await seeded();
    await price("broker", { instrumentId: id, date: "2026-01-31", price: 110 });
    await price("broker", { instrumentId: id, date: "2026-02-28", price: 120 });
    await price("broker", { instrumentId: id, date: "2026-03-31", price: 115 });

    const dates = (await valuations()).map((r) => r.date);
    expect(dates).toContain("2026-01-31");
    expect(dates).toContain("2026-02-28");
    expect(dates).toContain("2026-03-31");
  });

  it("replaces a same-day price rather than stacking a second one", async () => {
    const id = await seeded();
    await price("broker", { instrumentId: id, date: "2026-01-31", price: 110 });
    await price("broker", { instrumentId: id, date: "2026-01-31", price: 108 });

    const rows = await valuations();
    expect(rows.filter((r) => r.date === "2026-01-31")).toHaveLength(1);
    expect(rows.find((r) => r.date === "2026-01-31")?.value).toBe(1_080);
  });

  it("revalues every account holding the instrument, not just this one", async () => {
    const id = await seeded();
    await trade("broker2", {
      instrumentId: id,
      type: "buy",
      date: "2026-01-10",
      quantity: 5,
      unitPrice: 100,
    });

    await price("broker", { instrumentId: id, date: "2026-01-31", price: 110 });

    expect((await accountValue("broker")).value).toBe(1_100);
    // The same fund is worth the same in both accounts.
    expect((await accountValue("broker2")).value).toBe(550);
  });

  it("refuses a price dated in the future", async () => {
    const id = await seeded();
    expect(
      (await price("broker", { instrumentId: id, date: tomorrow(), price: 110 })).status,
    ).toBe(400);
  });

  it("refuses a negative price", async () => {
    const id = await seeded();
    expect(
      (await price("broker", { instrumentId: id, date: TODAY, price: -1 })).status,
    ).toBe(400);
  });
});

describe("uninvested cash", () => {
  /** A transfer leg landing in the brokerage, as detectTransfers writes it. */
  async function deposit(date: string, amount: number) {
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, created_at)
            VALUES (?, ?, 'broker', ?, 'Deposit', ?, 'internal_transfer', ?)`,
      args: [`dep-${date}-${amount}`, USER, date, amount, NOW],
    });
  }

  it("counts money deposited but not yet invested", async () => {
    await deposit("2026-01-02", 1_000);
    const res = await trade("broker", {
      instrument: ETF,
      type: "buy",
      date: "2026-01-05",
      quantity: 4,
      unitPrice: 100,
    });
    await price("broker", {
      instrumentId: res.body[0].instrument.id,
      date: "2026-01-31",
      price: 100,
    });

    // 400 in the fund, 600 still sitting as cash. Counting only the holdings
    // would report this as a 60% loss on the deposit.
    expect((await accountValue()).value).toBe(1_000);
  });

  it("values a deposit from the day it lands", async () => {
    await deposit("2026-01-02", 1_000);
    const res = await trade("broker", {
      instrument: ETF,
      type: "buy",
      date: "2026-01-05",
      quantity: 4,
      unitPrice: 100,
    });
    await price("broker", {
      instrumentId: res.body[0].instrument.id,
      date: "2026-01-05",
      price: 100,
    });
    await deposit("2026-02-02", 500);
    // Re-run the recompute so the later deposit is picked up.
    await price("broker", {
      instrumentId: res.body[0].instrument.id,
      date: "2026-02-02",
      price: 100,
    });

    const rows = await valuations();
    expect(rows.find((r) => r.date === "2026-01-05")?.value).toBe(1_000);
    expect(rows.find((r) => r.date === "2026-02-02")?.value).toBe(1_500);
  });

  it("does not show the account in debt when trades predate their transfers", async () => {
    const res = await trade("broker", {
      instrument: ETF,
      type: "buy",
      date: "2026-01-05",
      quantity: 4,
      unitPrice: 100,
    });
    await price("broker", {
      instrumentId: res.body[0].instrument.id,
      date: "2026-01-31",
      price: 100,
    });
    expect((await accountValue()).value).toBe(400);
  });
});

describe("deleting a trade", () => {
  async function del(accountId: string, tradeId: string) {
    const { DELETE } = await import("./[tradeId]/route");
    const res = await DELETE(new Request("http://t", { method: "DELETE" }) as never, {
      params: Promise.resolve({ id: accountId, tradeId }),
    });
    return { status: res.status, body: (await res.json()) as HoldingRow[] };
  }

  async function tradeIds() {
    const r = await testDb.client.execute({
      sql: `SELECT id, date FROM trades WHERE account_id = 'broker' ORDER BY date`,
    });
    return r.rows.map((row) => ({ id: row.id as string, date: row.date as string }));
  }

  it("rewrites the figures that followed it", async () => {
    const first = await trade("broker", {
      instrument: ETF,
      type: "buy",
      date: "2026-01-05",
      quantity: 10,
      unitPrice: 100,
    });
    const id = first.body[0].instrument.id;
    await trade("broker", {
      instrumentId: id,
      type: "buy",
      date: "2026-02-05",
      quantity: 10,
      unitPrice: 200,
    });
    await price("broker", { instrumentId: id, date: "2026-03-01", price: 150 });

    const [, second] = await tradeIds();
    const res = await del("broker", second.id);

    expect(res.status).toBe(200);
    expect(res.body[0].quantity).toBe(10);
    // The expensive buy is gone, so the average price goes back to the first.
    expect(res.body[0].averagePrice).toBe(100);
    expect((await accountValue()).value).toBe(1_500);
  });

  it("leaves the account unvalued once its last trade is gone", async () => {
    const first = await trade("broker", {
      instrument: ETF,
      type: "buy",
      date: "2026-01-05",
      quantity: 10,
      unitPrice: 100,
    });
    await price("broker", {
      instrumentId: first.body[0].instrument.id,
      date: "2026-01-31",
      price: 110,
    });

    const [only] = await tradeIds();
    await del("broker", only.id);

    expect((await holdings("broker")).body).toEqual([]);
    expect((await accountValue()).value).toBeNull();
  });

  it("404s a trade id that is not there", async () => {
    expect((await del("broker", "nope")).status).toBe(404);
  });
});

/**
 * The repair path for a holding that claims to have cost nothing.
 *
 * Rows like these predate the rule that a buy must carry a price, so the
 * endpoint has to both refuse new ones and let the old ones be corrected —
 * and correcting one has to move the cost, the cash and the account's whole
 * valuation history with it.
 */
describe("a trade with no price", () => {
  async function patch(accountId: string, tradeId: string, body: Record<string, unknown>) {
    const { PATCH } = await import("./[tradeId]/route");
    const res = await PATCH(
      new Request("http://t", { method: "PATCH", body: JSON.stringify(body) }) as never,
      { params: Promise.resolve({ id: accountId, tradeId }) },
    );
    return { status: res.status, body: (await res.json()) as HoldingRow[] };
  }

  /** What the UI used to allow: units with no price, written straight in. */
  async function legacyBuy(instrumentId: string, date: string, quantity: number) {
    await testDb.client.execute({
      sql: `INSERT INTO trades (id, user_id, account_id, instrument_id, date, type, quantity, unit_price, fee, created_at)
            VALUES ('legacy', ?, 'broker', ?, ?, 'buy', ?, 0, 0, ?)`,
      args: [USER, instrumentId, date, quantity, NOW],
    });
  }

  async function deposit(date: string, amount: number) {
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, created_at)
            VALUES (?, ?, 'broker', ?, 'Deposit', ?, 'internal_transfer', ?)`,
      args: [`dep-${date}-${amount}`, USER, date, amount, NOW],
    });
  }

  it("is refused outright", async () => {
    const res = await trade("broker", {
      instrument: ETF,
      type: "buy",
      date: "2026-01-05",
      quantity: 3,
      fee: 1,
    });
    expect(res.status).toBe(400);
  });

  it("reports no cost and no return while it stands", async () => {
    const seed = await trade("broker", {
      instrument: ETF,
      type: "buy",
      date: "2026-01-05",
      quantity: 1,
      unitPrice: 130,
    });
    const instrumentId = seed.body[0].instrument.id;
    await legacyBuy(instrumentId, "2026-01-06", 3);
    await price("broker", { instrumentId, date: "2026-01-31", price: 120 });

    const [held] = (await holdings("broker")).body;
    expect(held.quantity).toBe(4);
    expect(held.averagePrice).toBeNull();
    expect(held.totalReturn).toBeNull();
  });

  it("leaves the uninvested deposit out of the value rather than guessing", async () => {
    await deposit("2026-01-01", 448);
    const seed = await trade("broker", {
      instrument: ETF,
      type: "buy",
      date: "2026-01-05",
      quantity: 1,
      unitPrice: 130,
    });
    const instrumentId = seed.body[0].instrument.id;
    await legacyBuy(instrumentId, "2026-01-06", 2);
    await price("broker", { instrumentId, date: "2026-01-31", price: 120 });

    // 3 units at 120. The 448 deposit cannot be split into spent and spare
    // while one of the buys will not say what it cost, so none of it is
    // claimed as cash.
    expect((await accountValue()).value).toBe(360);
  });

  it("puts the cost, the cash and the history right once the price is filled in", async () => {
    await deposit("2026-01-01", 448);
    const seed = await trade("broker", {
      instrument: ETF,
      type: "buy",
      date: "2026-01-05",
      quantity: 1,
      unitPrice: 130,
    });
    const instrumentId = seed.body[0].instrument.id;
    await legacyBuy(instrumentId, "2026-01-06", 2);
    await price("broker", { instrumentId, date: "2026-01-31", price: 120 });

    const fixed = await patch("broker", "legacy", { unitPrice: 131 });
    expect(fixed.status).toBe(200);

    const [held] = fixed.body;
    expect(held.quantity).toBe(3);
    expect(held.costBasis).toBe(392);
    expect(held.averagePrice).toBeCloseTo(130.667, 3);
    expect(held.totalReturn).toBe(-32);

    // 448 in, 392 spent, 56 still cash — beside 360 of fund.
    expect((await accountValue()).value).toBe(416);
  });

  it("refuses a correction that would take the price back out", async () => {
    const seed = await trade("broker", {
      instrument: ETF,
      type: "buy",
      date: "2026-01-05",
      quantity: 1,
      unitPrice: 130,
    });
    const ids = await testDb.client.execute({
      sql: `SELECT id FROM trades WHERE account_id = 'broker'`,
    });
    expect(seed.status).toBe(201);
    const res = await patch("broker", ids.rows[0].id as string, { unitPrice: 0 });
    expect(res.status).toBe(400);
  });
});
