/**
 * The two lines behind the investments chart.
 *
 * What these pin, above everything else: value is only known on the days
 * someone wrote a figure down. It is carried forward flat between them and is
 * `null` before the first — never 0, never interpolated. Either shortcut would
 * draw movement the data cannot support, and the gap against contributions is
 * exactly where that lie would show up as a fake gain or loss.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { setupTestDb } from "./test-db";

const testDb = await setupTestDb("investment-series");

const { getInvestmentSeries } = await import("@/lib/investment-series");
const { db } = await import("@/db");
const { recordValuation } = await import("@/lib/valuations");

const ME = "series-me";
const NOW = new Date().toISOString();
const TODAY = "2026-06-30";
let seq = 0;

afterAll(() => testDb.cleanup());

beforeEach(async () => {
  await testDb.reset();
  await testDb.client.execute({
    sql: `INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)`,
    args: [ME, ME, `${ME}@test.dev`],
  });
  await testDb.client.execute({
    sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, created_at, updated_at)
          VALUES ('broker', ?, 'Broker', 'investment', 'EUR', 0, 0, ?, ?),
                 ('broker2', ?, 'Broker 2', 'investment', 'EUR', 0, 1, ?, ?),
                 ('cash', ?, 'Main', 'checking', 'EUR', 0, 2, ?, ?)`,
    args: [ME, NOW, NOW, ME, NOW, NOW, ME, NOW, NOW],
  });
});

const value = (accountId: string, date: string, v: number) =>
  recordValuation(db, { ownerId: ME, accountId, date, value: v });

const deposit = (accountId: string, date: string, amount: number) =>
  testDb.client.execute({
    sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, created_at)
          VALUES (?, ?, ?, ?, 'Deposit', ?, 'internal_transfer', ?)`,
    args: [`tx-${seq++}`, ME, accountId, date, amount, NOW],
  });

const at = <T extends { date: string }>(points: T[], date: string) =>
  points.find((p) => p.date === date);

describe("getInvestmentSeries", () => {
  it("is empty without investment accounts", async () => {
    await testDb.client.execute({ sql: `DELETE FROM accounts WHERE type = 'investment'` });
    const s = await getInvestmentSeries(ME, "2026-01-01", TODAY);
    expect(s.points).toEqual([]);
  });

  it("carries a value forward instead of interpolating to the next one", async () => {
    await value("broker", "2026-01-31", 1_000);
    await value("broker", "2026-03-31", 2_000);
    await deposit("broker", "2026-02-15", 500);

    const { points } = await getInvestmentSeries(ME, "2026-01-01", TODAY);
    // Mid-February sits between two figures: it holds January's, not a blend.
    expect(at(points, "2026-02-15")?.value).toBe(1_000);
    expect(at(points, "2026-03-31")?.value).toBe(2_000);
  });

  it("is null before the first figure, not zero", async () => {
    await deposit("broker", "2026-01-10", 500);
    await value("broker", "2026-03-31", 2_000);

    const { points } = await getInvestmentSeries(ME, "2026-01-01", TODAY);
    // The deposit counts from the day it landed: we knew what went in before
    // we knew what it was worth.
    expect(at(points, "2026-01-10")?.contributed).toBe(500);
    expect(at(points, "2026-01-10")?.value).toBeNull();
    expect(at(points, "2026-03-31")?.value).toBe(2_000);
  });

  it("starts at the first real event, not at a floor date the caller passed", async () => {
    await deposit("broker", "2026-01-10", 500);
    await value("broker", "2026-03-31", 2_000);

    // "Everything" is asked for as a floor far in the past. Taking it
    // literally would put a dead point decades before the first deposit and
    // squash the whole chart against its right edge.
    const { points } = await getInvestmentSeries(ME, "1970-01-01", TODAY);
    expect(points[0].date).toBe("2026-01-10");
  });

  it("is empty when nothing ever happened", async () => {
    const { points } = await getInvestmentSeries(ME, "1970-01-01", TODAY);
    expect(points).toEqual([]);
  });

  it("honours a window that opens after events already happened", async () => {
    await deposit("broker", "2026-01-10", 500);
    await value("broker", "2026-01-31", 600);
    await deposit("broker", "2026-05-10", 400);

    const { points } = await getInvestmentSeries(ME, "2026-04-01", TODAY);
    // April 1st had both a value and a running total behind it, so the window
    // opens there rather than skipping ahead to May.
    expect(points[0].date).toBe("2026-04-01");
    expect(points[0].value).toBe(600);
    expect(points[0].contributed).toBe(500);
  });

  it("accumulates contributions across dates", async () => {
    await value("broker", "2026-01-01", 0);
    await deposit("broker", "2026-01-10", 300);
    await deposit("broker", "2026-02-10", 200);
    await deposit("broker", "2026-03-10", 500);

    const { points } = await getInvestmentSeries(ME, "2026-01-01", TODAY);
    expect(at(points, "2026-01-10")?.contributed).toBe(300);
    expect(at(points, "2026-02-10")?.contributed).toBe(500);
    expect(at(points, "2026-03-10")?.contributed).toBe(1_000);
  });

  it("counts contributions from before the window in the running total", async () => {
    await value("broker", "2026-01-01", 5_000);
    await deposit("broker", "2025-06-01", 4_000);
    await deposit("broker", "2026-04-01", 1_000);

    const { points } = await getInvestmentSeries(ME, "2026-03-01", TODAY);
    // The window opens already carrying the older deposit.
    expect(points[0].contributed).toBe(4_000);
    expect(at(points, "2026-04-01")?.contributed).toBe(5_000);
  });

  it("opens at the figure in force before the window, not at the next one", async () => {
    await value("broker", "2025-11-30", 8_000);
    await value("broker", "2026-05-31", 9_000);

    const { points } = await getInvestmentSeries(ME, "2026-03-01", TODAY);
    expect(points[0].value).toBe(8_000);
  });

  it("adds up several accounts, counting each from its own first figure", async () => {
    await value("broker", "2026-01-31", 1_000);
    await value("broker2", "2026-03-31", 500);

    const { points } = await getInvestmentSeries(ME, "2026-01-01", TODAY);
    expect(at(points, "2026-01-31")?.value).toBe(1_000);
    expect(at(points, "2026-03-31")?.value).toBe(1_500);
  });

  it("ignores cash accounts on both lines", async () => {
    await value("broker", "2026-01-31", 1_000);
    await deposit("cash", "2026-02-01", 9_999);

    const { points } = await getInvestmentSeries(ME, "2026-01-01", TODAY);
    expect(points.every((p) => p.contributed === 0)).toBe(true);
  });

  it("lets a same-day correction win", async () => {
    await value("broker", "2026-02-01", 1_000);
    await value("broker", "2026-02-01", 1_250);

    const { points } = await getInvestmentSeries(ME, "2026-01-01", TODAY);
    expect(at(points, "2026-02-01")?.value).toBe(1_250);
  });

  it("marks only the dates a figure was actually recorded", async () => {
    await value("broker", "2026-01-31", 1_000);
    await value("broker", "2026-03-31", 2_000);
    await deposit("broker", "2026-02-15", 500);

    const { valuationDates } = await getInvestmentSeries(ME, "2026-01-01", TODAY);
    expect(valuationDates).toEqual(["2026-01-31", "2026-03-31"]);
  });

  it("samples where something changed, plus both endpoints", async () => {
    await value("broker", "2026-02-01", 1_000);
    await deposit("broker", "2026-03-01", 100);

    const { points } = await getInvestmentSeries(ME, "2026-01-01", TODAY);
    expect(points.map((p) => p.date)).toEqual(["2026-02-01", "2026-03-01", TODAY]);
  });
});
