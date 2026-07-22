import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("preferences");

const { getUserPreferences, updateUserPreferences, markAutoBudgetChecked } =
  await import("./preferences");

const USER = "user-1";

describe("user preferences", () => {
  afterAll(async () => {
    await testDb.cleanup();
  });

  beforeEach(async () => {
    await testDb.reset();
  });

  it("returns defaults when the user has no row", async () => {
    expect(await getUserPreferences(USER)).toEqual({
      autoBudgetEnabled: true,
      autoBudgetIntervalMonths: 1,
      autoBudgetLookbackMonths: 3,
      lastAutoBudgetCheckAt: null,
      financialMonthStartDay: 1,
      defaultAccountId: null,
      hideInternalTransfers: false,
    });
  });

  it("creates the row on first update and persists the patch", async () => {
    const updated = await updateUserPreferences(USER, {
      autoBudgetEnabled: false,
      financialMonthStartDay: 25,
    });
    expect(updated.autoBudgetEnabled).toBe(false);
    expect(updated.financialMonthStartDay).toBe(25);
    // Unpatched fields keep their defaults.
    expect(updated.autoBudgetLookbackMonths).toBe(3);

    const fetched = await getUserPreferences(USER);
    expect(fetched).toEqual(updated);
  });

  it("leaves other fields untouched on a partial patch", async () => {
    await updateUserPreferences(USER, { financialMonthStartDay: 25 });
    const after = await updateUserPreferences(USER, { autoBudgetEnabled: false });
    expect(after.financialMonthStartDay).toBe(25);
    expect(after.autoBudgetEnabled).toBe(false);
  });

  it("clamps interval and lookback months to 1–12 and rounds", async () => {
    let prefs = await updateUserPreferences(USER, {
      autoBudgetIntervalMonths: 0,
      autoBudgetLookbackMonths: 99,
    });
    expect(prefs.autoBudgetIntervalMonths).toBe(1);
    expect(prefs.autoBudgetLookbackMonths).toBe(12);

    prefs = await updateUserPreferences(USER, { autoBudgetIntervalMonths: 5.6 });
    expect(prefs.autoBudgetIntervalMonths).toBe(6);
  });

  it("clamps financialMonthStartDay to 1–28", async () => {
    let prefs = await updateUserPreferences(USER, { financialMonthStartDay: 31 });
    expect(prefs.financialMonthStartDay).toBe(28);
    prefs = await updateUserPreferences(USER, { financialMonthStartDay: -4 });
    expect(prefs.financialMonthStartDay).toBe(1);
  });

  it("sets and clears defaultAccountId", async () => {
    let prefs = await updateUserPreferences(USER, { defaultAccountId: "acct-1" });
    expect(prefs.defaultAccountId).toBe("acct-1");
    prefs = await updateUserPreferences(USER, { defaultAccountId: null });
    expect(prefs.defaultAccountId).toBeNull();
  });

  it("markAutoBudgetChecked stamps a recent ISO timestamp", async () => {
    await markAutoBudgetChecked(USER);
    const prefs = await getUserPreferences(USER);
    expect(prefs.lastAutoBudgetCheckAt).not.toBeNull();
    const age = Date.now() - new Date(prefs.lastAutoBudgetCheckAt!).getTime();
    expect(age).toBeGreaterThanOrEqual(0);
    expect(age).toBeLessThan(10_000);
  });

  it("keeps users separate", async () => {
    await updateUserPreferences(USER, { financialMonthStartDay: 25 });
    expect((await getUserPreferences("user-2")).financialMonthStartDay).toBe(1);
  });
});
