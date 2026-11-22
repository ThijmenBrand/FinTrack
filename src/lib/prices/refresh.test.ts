/**
 * What the daily refresh actually spends.
 *
 * The free plan allows twenty calls a day, so the interesting assertions here
 * are all about calls NOT made: a fund sold down to zero, one still priced
 * through the last close, one nobody linked. Each of those is a filter that
 * runs before a call is reserved, and together they are the difference between
 * a portfolio that fits the plan and one that runs out by lunchtime.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { setupTestDb } from "../test-db";

const testDb = await setupTestDb("price-refresh");

const { dueInstruments, refreshPrices } = await import("./refresh");
const { db } = await import("@/db");

const ME = "prices-me";
const NOW = new Date("2026-11-19T18:00:00Z"); // Thursday, after the close
const STAMP = "2026-11-19T18:00:00.000Z";
let seq = 0;

afterAll(() => testDb.cleanup());

beforeEach(async () => {
  await testDb.reset();
  process.env.EODHD_API_TOKEN = "test-token";
  await testDb.client.execute({
    sql: `INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)`,
    args: [ME, ME, `${ME}@test.dev`],
  });
  await testDb.client.execute({
    sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, created_at, updated_at)
          VALUES ('broker', ?, 'Broker', 'investment', 'EUR', 0, 0, ?, ?)`,
    args: [ME, STAMP, STAMP],
  });
});

async function instrument(
  id: string,
  opts: { symbol?: string | null; dataSource?: string } = {},
) {
  await testDb.client.execute({
    sql: `INSERT INTO instruments (id, user_id, name, isin, symbol, currency, asset_class, data_source, created_at)
          VALUES (?, ?, ?, NULL, ?, 'EUR', 'equity', ?, ?)`,
    args: [id, ME, id, opts.symbol ?? `${id}.AS`, opts.dataSource ?? "eodhd", STAMP],
  });
}

async function trade(instrumentId: string, type: string, quantity: number) {
  await testDb.client.execute({
    sql: `INSERT INTO trades (id, user_id, account_id, instrument_id, date, type, quantity, unit_price, fee, created_at)
          VALUES (?, ?, 'broker', ?, '2026-01-05', ?, ?, 100, 0, ?)`,
    args: [`t${seq++}`, ME, instrumentId, type, quantity, STAMP],
  });
}

async function price(instrumentId: string, date: string) {
  await testDb.client.execute({
    sql: `INSERT INTO instrument_prices (id, user_id, instrument_id, date, price, source, created_at)
          VALUES (?, ?, ?, ?, 100, 'provider', ?)`,
    args: [`p${seq++}`, ME, instrumentId, date, STAMP],
  });
}

/** A provider that records every call and answers with one close. */
function fakeProvider(closes: { date: string; close: number }[] = [
  { date: "2026-11-19", close: 123.45 },
]) {
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (url: URL | RequestInfo) => {
    urls.push(String(url));
    return new Response(JSON.stringify(closes), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { urls, fetchImpl };
}

describe("dueInstruments", () => {
  it("skips a holding that was sold down to zero", async () => {
    await instrument("held");
    await trade("held", "buy", 10);
    await instrument("sold");
    await trade("sold", "buy", 10);
    await trade("sold", "sell", 10);

    const due = await dueInstruments(db, ME, NOW);
    expect(due.map((d) => d.instrumentId)).toEqual(["held"]);
  });

  it("skips an instrument nobody linked to a provider", async () => {
    await instrument("manual", { dataSource: "manual" });
    await trade("manual", "buy", 5);
    expect(await dueInstruments(db, ME, NOW)).toEqual([]);
  });

  it("skips one already priced through the last close", async () => {
    await instrument("fresh");
    await trade("fresh", "buy", 5);
    await price("fresh", "2026-11-19");
    expect(await dueInstruments(db, ME, NOW)).toEqual([]);
  });

  it("asks only for the missing days", async () => {
    await instrument("stale");
    await trade("stale", "buy", 5);
    await price("stale", "2026-11-17");
    const [due] = await dueInstruments(db, ME, NOW);
    expect(due.from).toBe("2026-11-18");
  });

  it("puts the stalest holding first", async () => {
    await instrument("older");
    await trade("older", "buy", 5);
    await price("older", "2026-11-10");
    await instrument("newer");
    await trade("newer", "buy", 5);
    await price("newer", "2026-11-18");

    const due = await dueInstruments(db, ME, NOW);
    expect(due.map((d) => d.instrumentId)).toEqual(["older", "newer"]);
  });

  it("treats a never-priced holding as the most urgent of all", async () => {
    await instrument("priced");
    await trade("priced", "buy", 5);
    await price("priced", "2026-11-18");
    await instrument("unpriced");
    await trade("unpriced", "buy", 5);

    const due = await dueInstruments(db, ME, NOW);
    expect(due[0].instrumentId).toBe("unpriced");
    expect(due[0].latestPrice).toBeNull();
  });
});

describe("refreshPrices", () => {
  it("spends one call per due holding and stores the closes", async () => {
    await instrument("a");
    await trade("a", "buy", 5);
    await instrument("b");
    await trade("b", "buy", 5);

    const { urls, fetchImpl } = fakeProvider();
    const outcome = await refreshPrices(db, ME, { now: NOW, fetchImpl });

    expect(outcome).toMatchObject({ due: 2, called: 2, written: 2, deferred: 0 });
    expect(urls).toHaveLength(2);
    const rows = await testDb.client.execute("SELECT * FROM instrument_prices");
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].source).toBe("provider");
  });

  it("spends nothing at all when every holding is current", async () => {
    await instrument("a");
    await trade("a", "buy", 5);
    await price("a", "2026-11-19");

    const { urls, fetchImpl } = fakeProvider();
    const outcome = await refreshPrices(db, ME, { now: NOW, fetchImpl });

    expect(outcome).toMatchObject({ due: 0, called: 0 });
    expect(urls).toHaveLength(0);
  });

  it("spends nothing over a weekend", async () => {
    await instrument("a");
    await trade("a", "buy", 5);
    await price("a", "2026-11-20"); // Friday's close

    const { urls, fetchImpl } = fakeProvider();
    for (const day of ["2026-11-21T12:00:00Z", "2026-11-22T12:00:00Z"]) {
      const outcome = await refreshPrices(db, ME, { now: new Date(day), fetchImpl });
      expect(outcome.called).toBe(0);
    }
    expect(urls).toHaveLength(0);
  });

  it("defers what the budget cannot reach instead of failing", async () => {
    // Twenty holdings, sixteen background calls available.
    for (let i = 0; i < 20; i++) {
      await instrument(`i${i}`);
      await trade(`i${i}`, "buy", 5);
    }
    const { urls, fetchImpl } = fakeProvider();
    const outcome = await refreshPrices(db, ME, { now: NOW, fetchImpl });

    expect(outcome.due).toBe(20);
    expect(outcome.called).toBe(16);
    expect(outcome.deferred).toBe(4);
    expect(urls).toHaveLength(16);
  });

  it("keeps the interactive reserve intact after a full refresh", async () => {
    for (let i = 0; i < 20; i++) {
      await instrument(`i${i}`);
      await trade(`i${i}`, "buy", 5);
    }
    const { fetchImpl } = fakeProvider();
    await refreshPrices(db, ME, { now: NOW, fetchImpl });

    const { remainingFor } = await import("./budget");
    expect(await remainingFor("interactive", { now: NOW })).toBe(4);
  });

  it("stops the moment the provider says the budget is gone", async () => {
    for (let i = 0; i < 5; i++) {
      await instrument(`i${i}`);
      await trade(`i${i}`, "buy", 5);
    }
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n++;
      // The provider's own 402 on the second call, before our counter agrees.
      if (n >= 2) return new Response("", { status: 402 });
      return new Response(JSON.stringify([{ date: "2026-11-19", close: 1 }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const outcome = await refreshPrices(db, ME, { now: NOW, fetchImpl });
    expect(outcome.stoppedBy).toBe("budget_exhausted");
    // Two requests: the one that worked and the one that was refused. It does
    // not keep trying the remaining three.
    expect(n).toBe(2);
  });

  it("carries on past a single dead symbol", async () => {
    await instrument("gone");
    await trade("gone", "buy", 5);
    await instrument("fine");
    await trade("fine", "buy", 5);

    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n++;
      if (n === 1) return new Response("", { status: 404 });
      return new Response(JSON.stringify([{ date: "2026-11-19", close: 7 }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const outcome = await refreshPrices(db, ME, { now: NOW, fetchImpl });
    expect(n).toBe(2);
    expect(outcome.written).toBe(1);
  });

  it("asks the provider for the right window", async () => {
    await instrument("a");
    await trade("a", "buy", 5);
    await price("a", "2026-11-17");

    const { urls, fetchImpl } = fakeProvider();
    await refreshPrices(db, ME, { now: NOW, fetchImpl });

    expect(urls[0]).toContain("/eod/a.AS");
    expect(urls[0]).toContain("from=2026-11-18");
  });

  it("lets a provider price overwrite one typed for the same day", async () => {
    await instrument("a");
    await trade("a", "buy", 5);
    await testDb.client.execute({
      sql: `INSERT INTO instrument_prices (id, user_id, instrument_id, date, price, source, created_at)
            VALUES ('manual-row', ?, 'a', '2026-11-19', 1, 'manual', ?)`,
      args: [ME, STAMP],
    });
    // Stored through the last close, so only an explicit backfill reaches it.
    const { fetchImpl } = fakeProvider([{ date: "2026-11-19", close: 999 }]);
    const { storeCloses } = await import("./refresh");
    await storeCloses(db, ME, "a", [{ date: "2026-11-19", close: 999 }]);
    void fetchImpl;

    const rows = await testDb.client.execute(
      "SELECT price, source FROM instrument_prices WHERE instrument_id = 'a'",
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].price).toBe(999);
    expect(rows.rows[0].source).toBe("provider");
  });

  it("hands a missing token back rather than walking the whole list", async () => {
    for (let i = 0; i < 3; i++) {
      await instrument(`i${i}`);
      await trade(`i${i}`, "buy", 5);
    }
    delete process.env.EODHD_API_TOKEN;
    const { fetchImpl } = fakeProvider();

    // No request can leave, so there is nothing to retry and nothing to
    // report per holding: the error belongs to whoever configures the server.
    await expect(refreshPrices(db, ME, { now: NOW, fetchImpl })).rejects.toMatchObject({
      code: "not_configured",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("defers what never got its turn, not the call that failed", async () => {
    for (let i = 0; i < 5; i++) {
      await instrument(`i${i}`);
      await trade(`i${i}`, "buy", 5);
    }
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n++;
      if (n >= 2) return new Response("", { status: 402 });
      return new Response(JSON.stringify([{ date: "2026-11-19", close: 1 }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const outcome = await refreshPrices(db, ME, { now: NOW, fetchImpl });
    // One priced, one refused, three never attempted. The refused one is not
    // waiting for anything — counting it as deferred would overstate what
    // tomorrow has to catch up on.
    expect(outcome).toMatchObject({ due: 5, called: 1, deferred: 3 });
  });
});
