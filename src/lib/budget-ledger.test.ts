import { describe, it, expect } from "vitest";
import {
  annualPot,
  buildYear,
  cascade,
  envelopeStatus,
  yearSpent,
  type LedgerMonthInput,
} from "./budget-ledger";
import { getFinancialYearMonths } from "./financial-year";

const SLOTS = getFinancialYearMonths(2026, 1);

/** Twelve months with the given spend, nothing closed unless told otherwise. */
function months(
  spend: number[],
  opts: { closedThrough?: number; frozen?: Record<number, number> } = {},
): LedgerMonthInput[] {
  const { closedThrough = 0, frozen = {} } = opts;
  return SLOTS.map((slot) => ({
    ...slot,
    closed: slot.monthIndex < closedThrough,
    frozenTarget: frozen[slot.monthIndex] ?? null,
    spent: spend[slot.monthIndex] ?? 0,
  }));
}

const round = (n: number) => Math.round(n * 100) / 100;

describe("cascade — the basic chain", () => {
  it("gives every month the same target when nothing carries", () => {
    const result = cascade(months(Array(12).fill(100)), { monthlyAmount: 100 });
    expect(result.map((m) => m.target)).toEqual(Array(12).fill(100));
    expect(result.map((m) => m.rolloverIn)).toEqual(Array(12).fill(0));
    expect(result.map((m) => m.allowance)).toEqual(Array(12).fill(100));
  });

  it("rolls an underspend forward into the next month's allowance", () => {
    // Spend 60 of 100 in January.
    const result = cascade(months([60]), { monthlyAmount: 100 });
    expect(result[0].rolloverOut).toBe(40);
    expect(result[1].rolloverIn).toBe(40);
    expect(result[1].allowance).toBe(140);
  });

  it("carries debt forward when a month overspends (symmetric)", () => {
    // July blows 250 of a 100 allowance.
    const spend = Array(12).fill(0);
    spend[6] = 250;
    const result = cascade(months(spend), { monthlyAmount: 100 });
    // Jan–Jun each banked 100, so July had 700 available and still had room.
    expect(result[6].rolloverIn).toBe(600);
    expect(result[6].allowance).toBe(700);
    expect(result[7].rolloverIn).toBe(450);
  });

  it("hands a negative allowance to the next month when the pot is behind", () => {
    // January alone spends 400 against a 100 target.
    const result = cascade(months([400]), { monthlyAmount: 100 });
    expect(result[0].rolloverOut).toBe(-300);
    expect(result[1].rolloverIn).toBe(-300);
    // February's own 100 does not wipe the debt — it only dents it.
    expect(result[1].allowance).toBe(-200);
  });

  it("accumulates across many months without drift", () => {
    const result = cascade(months(Array(12).fill(80)), { monthlyAmount: 100 });
    expect(result[11].rolloverIn).toBe(220); // 11 months × 20 saved
    expect(round(result[11].rolloverOut)).toBe(240);
  });
});

describe("cascade — closed months freeze their target", () => {
  it("keeps the old target for months that already ended", () => {
    // Jan–Jun closed at 100/mo, then the user raises the budget to 150.
    const frozen = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [i, 100]),
    );
    const result = cascade(months(Array(12).fill(0), { closedThrough: 6, frozen }), {
      monthlyAmount: 150,
    });
    expect(result.slice(0, 6).map((m) => m.target)).toEqual(Array(6).fill(100));
    expect(result.slice(6).map((m) => m.target)).toEqual(Array(6).fill(150));
    // The raise applies to the remaining months only: 600 + 900.
    expect(annualPot(result)).toBe(1500);
  });

  it("ignores a frozen target on a month that is still open", () => {
    // A stale snapshot must not override an allocation the user just changed.
    const result = cascade(months(Array(12).fill(0), { frozen: { 3: 100 } }), {
      monthlyAmount: 150,
    });
    expect(result[3].target).toBe(150);
  });

  it("mid-year raise: spent 700 of 1200, new total 1800, six months left", () => {
    // The scenario from the spec. Jan–Jun closed at 100/mo and spent 700
    // between them; from July the monthly amount becomes 150.
    const spend = [100, 100, 100, 100, 150, 150, 0, 0, 0, 0, 0, 0];
    const frozen = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [i, 100]),
    );
    const result = cascade(months(spend, { closedThrough: 6, frozen }), {
      monthlyAmount: 150,
    });
    expect(yearSpent(result)).toBe(700);
    expect(annualPot(result)).toBe(1500);
    // July inherits the 100 underspend from the first half.
    expect(result[6].rolloverIn).toBe(-100);
    expect(result[6].allowance).toBe(50);
    // What is left for the rest of the year: pot minus what is already gone.
    expect(annualPot(result) - yearSpent(result)).toBe(800);
  });
});

describe("cascade — a category that joins mid-year", () => {
  it("gets no target and no carry-over before it starts", () => {
    const result = cascade(months(Array(12).fill(0)), {
      monthlyAmount: 100,
      startMonthIndex: 6,
    });
    expect(result.slice(0, 6).map((m) => m.target)).toEqual(Array(6).fill(0));
    expect(result.slice(0, 6).map((m) => m.rolloverIn)).toEqual(Array(6).fill(0));
    expect(result[6].rolloverIn).toBe(0);
    expect(result[6].allowance).toBe(100);
  });

  it("is prorated to the months it covers", () => {
    const result = cascade(months(Array(12).fill(0)), {
      monthlyAmount: 100,
      startMonthIndex: 6,
    });
    expect(annualPot(result)).toBe(600);
  });

  it("still counts spend from before it started, without budgeting for it", () => {
    // Money spent in the category before it was budgeted is history, not
    // something the envelope has to absorb.
    const spend = Array(12).fill(0);
    spend[2] = 500;
    const result = cascade(months(spend), {
      monthlyAmount: 100,
      startMonthIndex: 6,
    });
    expect(result[2].spent).toBe(500);
    expect(result[6].rolloverIn).toBe(0);
    expect(yearSpent(result)).toBe(500);
  });

  it("prorates to nothing for a start beyond the year", () => {
    const result = cascade(months([]), { monthlyAmount: 100, startMonthIndex: 12 });
    expect(annualPot(result)).toBe(0);
  });
});

describe("the year boundary resets the envelope", () => {
  it("starts a fresh year at zero carry-over regardless of last year", () => {
    // Last year ended 400 in the red — 1,600 spent against a 1,200 pot…
    const lastYear = cascade(months([800, 800]), { monthlyAmount: 100 });
    expect(lastYear[11].rolloverOut).toBe(-400);
    // …and this year opens with a clean slate, because cascade never sees it.
    const thisYear = cascade(months([]), { monthlyAmount: 100 });
    expect(thisYear[0].rolloverIn).toBe(0);
    expect(thisYear[0].allowance).toBe(100);
  });
});

describe("envelopeStatus", () => {
  const evenSpend = (n: number) => Array(12).fill(n);

  it("is ok while both the month and the year have room", () => {
    const result = cascade(months(evenSpend(80)), { monthlyAmount: 100 });
    expect(envelopeStatus(result, 5)).toBe("ok");
  });

  it("is amber when this month outruns its allowance but the year is fine", () => {
    const spend = Array(12).fill(0);
    spend[0] = 150; // 150 spent against January's 100
    const result = cascade(months(spend), { monthlyAmount: 100 });
    expect(envelopeStatus(result, 0)).toBe("month-over");
  });

  it("is red once the whole annual pot is gone", () => {
    const spend = Array(12).fill(0);
    spend[0] = 1300; // more than the 1200 pot
    const result = cascade(months(spend), { monthlyAmount: 100 });
    expect(envelopeStatus(result, 0)).toBe("year-over");
  });

  it("stays ok when a month spends exactly its allowance", () => {
    const result = cascade(months(evenSpend(100)), { monthlyAmount: 100 });
    expect(envelopeStatus(result, 11)).toBe("ok");
  });

  it("does not fire on sub-cent float noise", () => {
    // 0.1 × 3 overshoots 0.3 in binary floating point.
    const spend = Array(12).fill(0);
    spend[0] = 0.1 + 0.1 + 0.1;
    const result = cascade(months(spend), { monthlyAmount: 0.3 });
    expect(envelopeStatus(result, 0)).toBe("ok");
  });

  it("prefers the year warning over the month warning", () => {
    const spend = Array(12).fill(0);
    spend[3] = 5000;
    const result = cascade(months(spend), { monthlyAmount: 100 });
    expect(envelopeStatus(result, 3)).toBe("year-over");
  });
});

describe("buildYear", () => {
  it("assembles the chain from spend totals and a closed-through marker", () => {
    const result = buildYear({
      slots: SLOTS,
      spentByMonth: new Map([
        [0, 60],
        [1, 130],
      ]),
      frozenTargets: new Map([[0, 100]]),
      closedThrough: 2,
      monthlyAmount: 120,
    });

    expect(result[0].target).toBe(100);
    expect(result[0].rolloverOut).toBe(40);
    // February closed too, but had no frozen target on record, so it falls
    // back to the live amount.
    expect(result[1].target).toBe(120);
    expect(result[1].allowance).toBe(160);
    expect(result[1].rolloverOut).toBe(30);
    expect(result[2].rolloverIn).toBe(30);
    expect(result[2].closed).toBe(false);
  });

  it("treats an absent month as zero spend, not a gap in the chain", () => {
    const result = buildYear({
      slots: SLOTS,
      spentByMonth: new Map(),
      closedThrough: 0,
      monthlyAmount: 50,
    });
    expect(yearSpent(result)).toBe(0);
    expect(annualPot(result)).toBe(600);
    expect(result[11].rolloverIn).toBe(550);
  });
});
