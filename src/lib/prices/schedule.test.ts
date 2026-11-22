/**
 * When a price call is worth making.
 *
 * These rules exist for one reason: the plan allows twenty calls a day. Every
 * `null` below is a call not spent, and the cases that matter most are the
 * boring ones — a weekend, an hour before the close — because those are when
 * a naive refresh would quietly burn the whole budget on prices that have not
 * changed since the last time it asked.
 */
import { describe, it, expect } from "vitest";
import { lastClosedTradingDay, nextFetchFrom, isWeekend, addDays } from "./schedule";

const at = (iso: string) => new Date(iso);

describe("lastClosedTradingDay", () => {
  it("is yesterday before the close", () => {
    // Thursday 09:00 UTC — Thursday's close does not exist yet.
    expect(lastClosedTradingDay(at("2026-11-19T09:00:00Z"))).toBe("2026-11-18");
  });

  it("is today once the market has closed", () => {
    expect(lastClosedTradingDay(at("2026-11-19T18:00:00Z"))).toBe("2026-11-19");
  });

  it("steps back over the weekend to Friday", () => {
    expect(lastClosedTradingDay(at("2026-11-21T12:00:00Z"))).toBe("2026-11-20");
    expect(lastClosedTradingDay(at("2026-11-22T12:00:00Z"))).toBe("2026-11-20");
  });

  it("does not jump to Monday before Monday has closed", () => {
    // 09:00 Monday: still Friday's close. Asking now would cost a call and
    // return rows already stored.
    expect(lastClosedTradingDay(at("2026-11-23T09:00:00Z"))).toBe("2026-11-20");
  });
});

describe("isWeekend", () => {
  it("knows Saturday and Sunday", () => {
    expect(isWeekend(at("2026-11-21T12:00:00Z"))).toBe(true);
    expect(isWeekend(at("2026-11-22T12:00:00Z"))).toBe(true);
    expect(isWeekend(at("2026-11-20T12:00:00Z"))).toBe(false);
  });
});

describe("nextFetchFrom", () => {
  it("spends nothing when the stored history already reaches the last close", () => {
    expect(nextFetchFrom("2026-11-20", at("2026-11-21T12:00:00Z"))).toBeNull();
    expect(nextFetchFrom("2026-11-20", at("2026-11-22T12:00:00Z"))).toBeNull();
    expect(nextFetchFrom("2026-11-20", at("2026-11-23T09:00:00Z"))).toBeNull();
  });

  it("asks only for the days it is missing", () => {
    expect(nextFetchFrom("2026-11-18", at("2026-11-19T18:00:00Z"))).toBe("2026-11-19");
  });

  it("asks from the beginning when nothing is stored", () => {
    const from = nextFetchFrom(null, at("2026-11-19T18:00:00Z"), 5);
    expect(from).toBe("2021-11-19");
  });

  it("never asks twice for the same close", () => {
    // Priced Thursday evening; every call before Friday's close is wasted.
    const now = at("2026-11-19T18:00:00Z");
    expect(nextFetchFrom("2026-11-19", now)).toBeNull();
    expect(nextFetchFrom("2026-11-19", at("2026-11-20T09:00:00Z"))).toBeNull();
    expect(nextFetchFrom("2026-11-19", at("2026-11-20T18:00:00Z"))).toBe("2026-11-20");
  });
});

describe("addDays", () => {
  it("crosses a month boundary", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
  });
});
