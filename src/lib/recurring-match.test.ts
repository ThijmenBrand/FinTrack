import { describe, it, expect } from "vitest";
import {
  findRecurringForRow,
  isPaymentProcessorName,
  learnMatchRule,
  looksLikePlan,
  matchesPlanRule,
  rowMatchesPlan,
  type MatchablePlan,
} from "./recurring-match";

function plan(overrides: Partial<MatchablePlan> = {}): MatchablePlan {
  return {
    id: "hbo",
    accountId: "acc",
    description: "HBO Max",
    amount: -4.5,
    type: "expense",
    isActive: true,
    matchPattern: null,
    matchField: "name",
    ...overrides,
  };
}

const row = (overrides: Partial<Parameters<typeof findRecurringForRow>[0]> = {}) => ({
  accountId: "acc",
  amount: -4.5,
  name: "HBO Max",
  description: "Incasso 2026-09 ref 88123",
  ...overrides,
});

describe("learnMatchRule", () => {
  it("learns the counterparty name — the stable part of a bank row", () => {
    expect(learnMatchRule({ name: "  HBO Max  ", description: "Incasso ref 88123" })).toEqual({
      matchPattern: "HBO Max",
      matchField: "name",
    });
  });

  it("learns a nameless row's description — the title a single-column import shows", () => {
    const learned = learnMatchRule({ name: null, description: " VERmax Messtechnik GmbH " });
    expect(learned).toEqual({ matchPattern: "VERmax Messtechnik GmbH", matchField: "name" });
    // The "name" rule reads the description on such rows, so it finds the next one.
    expect(matchesPlanRule(learned!, null, "VERMAX MESSTECHNIK GMBH")).toBe(true);
  });

  it("learns nothing from a nameless row whose text is a memo with references", () => {
    expect(
      learnMatchRule({ name: null, description: "SEPA Incasso algemeen doorlopend Incassant NL12ZZZ301234560000" }),
    ).toBeNull();
    expect(learnMatchRule({ name: null, description: "Betaalautomaat 01-10-2026 12:04 pasnr. 001" })).toBeNull();
    // A name is learned even when it carries digits — it's the payee, not a memo.
    expect(learnMatchRule({ name: "Basic-Fit 1234", description: "" })?.matchPattern).toBe("Basic-Fit 1234");
  });

  it("learns nothing from a row with no text at all", () => {
    expect(learnMatchRule({ name: null, description: "" })).toBeNull();
    expect(learnMatchRule({ name: "   ", description: "  " })).toBeNull();
  });

  it("learns nothing from a title that is only a payment processor", () => {
    expect(learnMatchRule({ name: "PayPal Europe S.a.r.l. et Cie S.C.A", description: "" })).toBeNull();
    expect(learnMatchRule({ name: null, description: "Stichting Mollie Payments" })).toBeNull();
    expect(learnMatchRule({ name: "SumUp *Bakker Jansen", description: "" })?.matchPattern).toBe(
      "SumUp *Bakker Jansen",
    );
  });

  it("caps the pattern at the rule length limit", () => {
    const learned = learnMatchRule({ name: "x".repeat(300), description: "" });
    expect(learned?.matchPattern).toHaveLength(200);
  });

});

describe("isPaymentProcessorName", () => {
  it("spots a processor wrapped in legal-entity words", () => {
    for (const name of [
      "PayPal Europe S.a.r.l. et Cie S.C.A",
      "Stichting Mollie Payments",
      "Adyen N.V.",
      "Klarna Bank AB",
      "Stichting Derdengelden Buckaroo",
      "STRIPE PAYMENTS EUROPE LTD",
    ]) {
      expect(isPaymentProcessorName(name), name).toBe(true);
    }
  });

  it("keeps names that carry a merchant", () => {
    for (const name of ["SumUp *Bakker Jansen", "CCV*Cafe de Zwaan", "HBO Max", "Netflix International B.V.", "Bank of Spain"]) {
      expect(isPaymentProcessorName(name), name).toBe(false);
    }
  });
});

describe("matchesPlanRule", () => {
  it("is case-insensitive contains on the rule's field", () => {
    const p = plan({ matchPattern: "hbo max", matchField: "name" });
    expect(matchesPlanRule(p, "HBO MAX EUROPE", "x")).toBe(true);
    expect(matchesPlanRule(p, "PayPal", "hbo max")).toBe(false);
  });

  it("can read the description instead — for payments routed through PayPal", () => {
    const p = plan({ matchPattern: "hbo", matchField: "description" });
    expect(matchesPlanRule(p, "PayPal Europe", "1043 HBO MAX")).toBe(true);
    expect(matchesPlanRule(p, "HBO", "PayPal 1043")).toBe(false);
  });

  it("never matches without a rule", () => {
    expect(matchesPlanRule(plan(), "HBO Max", "HBO Max")).toBe(false);
  });
});

describe("findRecurringForRow", () => {
  it("links by rule whatever the amount — a price change is the same bill", () => {
    const plans = [plan({ matchPattern: "HBO Max" })];
    expect(findRecurringForRow(row({ amount: -9.99 }), plans)).toBe("hbo");
  });

  it("without a rule, still guesses by description and amount", () => {
    expect(findRecurringForRow(row(), [plan()])).toBe("hbo");
    expect(findRecurringForRow(row({ amount: -9.99 }), [plan()])).toBeNull();
  });

  it("prefers a rule over another plan's amount guess", () => {
    const plans = [
      plan({ id: "guess", description: "HBO", amount: -9.99 }),
      plan({ id: "ruled", description: "Streaming", amount: -4.5, matchPattern: "HBO Max" }),
    ];
    expect(findRecurringForRow(row({ amount: -9.99 }), plans)).toBe("ruled");
  });

  it("breaks a tie between rules by the closest amount", () => {
    const plans = [
      plan({ id: "basic", amount: -4.5, matchPattern: "HBO" }),
      plan({ id: "premium", amount: -12, matchPattern: "HBO" }),
    ];
    expect(findRecurringForRow(row({ amount: -11 }), plans)).toBe("premium");
  });

  it("keeps to the plan's account, direction and active state", () => {
    const ruled = plan({ matchPattern: "HBO Max" });
    expect(findRecurringForRow(row({ accountId: "other" }), [ruled])).toBeNull();
    expect(findRecurringForRow(row({ amount: 4.5 }), [ruled])).toBeNull();
    expect(findRecurringForRow(row(), [{ ...ruled, isActive: false }])).toBeNull();
  });
});

describe("a row unlinked by hand", () => {
  it("is never matched to that plan again", () => {
    const ruled = plan({ matchPattern: "HBO" });
    expect(rowMatchesPlan(ruled, row({ recurringExcludedPlanId: "hbo" }))).toBe(false);
    expect(findRecurringForRow(row({ recurringExcludedPlanId: "hbo" }), [ruled])).toBeNull();
    expect(findRecurringForRow(row({ recurringExcludedPlanId: "hbo" }), [plan()])).toBeNull();
  });

  it("can still go to another plan", () => {
    const other = plan({ id: "other", matchPattern: "HBO" });
    expect(findRecurringForRow(row({ recurringExcludedPlanId: "hbo" }), [plan(), other])).toBe("other");
  });
});

describe("rowMatchesPlan", () => {
  it("lets an explicit backfill reach a paused plan", () => {
    expect(rowMatchesPlan(plan({ isActive: false }), row())).toBe(true);
    expect(rowMatchesPlan(plan({ isActive: false, matchPattern: "HBO" }), row({ amount: -20 }))).toBe(true);
  });

  it("refuses the other account and the other direction", () => {
    expect(rowMatchesPlan(plan({ matchPattern: "HBO" }), row({ accountId: "x" }))).toBe(false);
    expect(rowMatchesPlan(plan({ matchPattern: "HBO" }), row({ amount: 4.5 }))).toBe(false);
  });
});

describe("looksLikePlan", () => {
  it("matches the plan's description inside the bank text", () => {
    expect(looksLikePlan("HBO Max", "HBO MAX EUROPE", "ref")).toBe(true);
  });

  it("matches on the plan's first word when the rest differs", () => {
    expect(looksLikePlan("Netflix subscription", null, "NETFLIX.COM Amsterdam")).toBe(true);
  });

  it("wants the first word whole, and long enough to mean something", () => {
    expect(looksLikePlan("Gym membership", "Gymnastics club", "x")).toBe(false);
    expect(looksLikePlan("EB energy", "Web shop", "eb")).toBe(false);
  });
});
