import { describe, it, expect } from "vitest";
import {
  parseAmount,
  parseDate,
  matchesRule,
  splitNameAndDescription,
  extractPattern,
  findMatchingRecurring,
  splitDuplicates,
  isUnsettledRow,
  applyFee,
} from "./csv-utils";

describe("applyFee", () => {
  // Real Revolut rows: the balance went 888,92 -> 880,85 -> 477,40, i.e. the
  // -403,45 withdrawal actually cost 411,52 once its 8,07 fee is counted.
  it("subtracts the fee from an expense", () => {
    expect(applyFee(-403.45, "8.07")).toBe(-411.52);
    expect(applyFee(-443.45, "8.87")).toBe(-452.32);
  });

  it("subtracts the fee from income too", () => {
    expect(applyFee(100, "1.00")).toBe(99);
  });

  it("leaves the amount alone when there is no fee", () => {
    expect(applyFee(-5, "")).toBe(-5);
    expect(applyFee(-5, undefined)).toBe(-5);
    expect(applyFee(-5, "0")).toBe(-5);
    expect(applyFee(-5, "0.00")).toBe(-5);
    expect(applyFee(-5, "not a number")).toBe(-5);
  });

  it("handles European decimal commas", () => {
    expect(applyFee(-403.45, "8,07")).toBe(-411.52);
  });

  it("does not accumulate binary float error", () => {
    // 0.1 + 0.2 territory — a raw subtraction here yields -411.51999999999995.
    expect(applyFee(-411.52, "0.1")).toBe(-411.62);
  });
});

describe("isUnsettledRow", () => {
  // Revolut exports PENDING/REVERTED rows with an empty Balance cell. Importing
  // them double-counted €1.239,99 on the Revolut account (July 2026): a -393
  // transfer and a -846,99 cash withdrawal that had both already settled.
  it("drops a row whose mapped balance cell is empty", () => {
    expect(isUnsettledRow(true, "")).toBe(true);
    expect(isUnsettledRow(true, undefined)).toBe(true);
    expect(isUnsettledRow(true, "   ")).toBe(true);
  });

  it("keeps a settled row that carries a balance", () => {
    expect(isUnsettledRow(true, "0.56")).toBe(false);
    // A genuine zero balance is still settled — must not be read as blank.
    expect(isUnsettledRow(true, "0")).toBe(false);
  });

  it("keeps every row when the export has no balance column", () => {
    // Erste Bank / savings exports: all 206 rows blank, all real.
    expect(isUnsettledRow(false, undefined)).toBe(false);
    expect(isUnsettledRow(false, "")).toBe(false);
  });
});

describe("parseAmount", () => {
  it("parses plain amounts", () => {
    expect(parseAmount("1234.56")).toBe(1234.56);
    expect(parseAmount("12")).toBe(12);
    expect(parseAmount("-7.5")).toBe(-7.5);
  });

  it("parses US format with thousands separators", () => {
    expect(parseAmount("1,234.56")).toBe(1234.56);
    expect(parseAmount("12,345,678.90")).toBe(12345678.9);
  });

  it("parses European format", () => {
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("12,50")).toBe(12.5);
  });

  it("strips currency symbols and whitespace", () => {
    expect(parseAmount("-$1,234.56")).toBe(-1234.56);
    expect(parseAmount("€ 12,50")).toBe(12.5);
    expect(parseAmount("£99.99")).toBe(99.99);
    expect(parseAmount("¥ 1000")).toBe(1000);
  });

  it("normalizes Unicode minus signs to ASCII", () => {
    expect(parseAmount("−12.34")).toBe(-12.34); // U+2212 minus
    expect(parseAmount("–5,00")).toBe(-5); // en-dash
    expect(parseAmount("—10,00")).toBe(-10); // em-dash
  });

  it("returns NaN for garbage", () => {
    expect(parseAmount("abc")).toBeNaN();
    expect(parseAmount("")).toBeNaN();
  });
});

describe("parseDate", () => {
  it("passes through ISO dates", () => {
    expect(parseDate("2026-05-01")).toBe("2026-05-01");
  });

  it("truncates ISO timestamps to the date part", () => {
    expect(parseDate("2026-05-01T10:30:00Z")).toBe("2026-05-01");
  });

  it("parses DD/MM/YYYY", () => {
    expect(parseDate("01/05/2026")).toBe("2026-05-01");
    expect(parseDate("31/12/2025")).toBe("2025-12-31");
  });

  it("parses DD-MM-YYYY and single-digit day/month", () => {
    expect(parseDate("1-5-2026")).toBe("2026-05-01");
    expect(parseDate("09-11-2026")).toBe("2026-11-09");
  });

  it("parses DD.MM.YYYY", () => {
    expect(parseDate("25.02.2026")).toBe("2026-02-25");
  });

  it("swaps to MM/DD/YYYY when the middle part cannot be a month", () => {
    expect(parseDate("04/25/2026")).toBe("2026-04-25");
  });

  it("rejects dates where neither order is valid", () => {
    expect(parseDate("13/13/2026")).toBeNull();
    expect(parseDate("00/05/2026")).toBeNull();
    expect(parseDate("05/32/2026")).toBeNull();
  });

  it("falls back to native Date parsing", () => {
    expect(parseDate("May 5, 2026")).toBe("2026-05-05");
  });

  it("returns null for unparseable input", () => {
    expect(parseDate("not a date")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("matchesRule", () => {
  it("matches 'contains' case-insensitively", () => {
    expect(matchesRule("Albert Heijn 1234", "albert", "contains")).toBe(true);
    expect(matchesRule("Albert Heijn 1234", "HEIJN", "contains")).toBe(true);
    expect(matchesRule("Albert Heijn 1234", "jumbo", "contains")).toBe(false);
  });

  it("matches 'exact' on the whole string only", () => {
    expect(matchesRule("Spotify", "spotify", "exact")).toBe(true);
    expect(matchesRule("Spotify AB", "spotify", "exact")).toBe(false);
  });

  it("matches 'starts_with' on the prefix only", () => {
    expect(matchesRule("PayPal Europe", "paypal", "starts_with")).toBe(true);
    expect(matchesRule("Via PayPal", "paypal", "starts_with")).toBe(false);
  });

  it("treats an unknown matchType as 'contains'", () => {
    expect(matchesRule("Albert Heijn", "heijn", "bogus")).toBe(true);
  });
});

describe("splitNameAndDescription", () => {
  it("keeps both fields when both are present", () => {
    expect(splitNameAndDescription("Albert Heijn", "groceries")).toEqual({
      name: "Albert Heijn",
      description: "groceries",
    });
  });

  it("puts a lone name into description", () => {
    expect(splitNameAndDescription("Albert Heijn", undefined)).toEqual({
      name: null,
      description: "Albert Heijn",
    });
    expect(splitNameAndDescription("Albert Heijn", "  ")).toEqual({
      name: null,
      description: "Albert Heijn",
    });
  });

  it("puts a lone description into description", () => {
    expect(splitNameAndDescription(undefined, "groceries")).toEqual({
      name: null,
      description: "groceries",
    });
  });

  it("returns an empty description when neither is present", () => {
    expect(splitNameAndDescription(undefined, undefined)).toEqual({
      name: null,
      description: "",
    });
  });

  it("trims whitespace on both fields", () => {
    expect(splitNameAndDescription("  AH  ", "  memo  ")).toEqual({
      name: "AH",
      description: "memo",
    });
  });
});

describe("extractPattern", () => {
  it("takes the text before '>' for card transactions and strips trailing store ids", () => {
    expect(extractPattern("AH Strijp 8616 >EINDHOVEN25.02.2026")).toBe(
      "AH Strijp",
    );
  });

  it("keeps the pre-arrow text when there is no trailing number", () => {
    expect(extractPattern("Bakkerij Jansen >TILBURG")).toBe("Bakkerij Jansen");
  });

  it("takes the first three words when there is no '>'", () => {
    expect(extractPattern("PayPal Europe S.a.r.l. et Cie SCA")).toBe(
      "PayPal Europe S.a.r.l.",
    );
  });

  it("returns short descriptions unchanged", () => {
    expect(extractPattern("Albert Heijn")).toBe("Albert Heijn");
  });
});

describe("findMatchingRecurring", () => {
  const plan = (over: Partial<Parameters<typeof findMatchingRecurring>[4][0]> = {}) => ({
    id: "plan-1",
    accountId: "acct-1",
    description: "Netflix",
    amount: 12.99,
    type: "expense",
    isActive: true,
    ...over,
  });

  it("matches an expense row against an expense plan by description substring", () => {
    expect(
      findMatchingRecurring("acct-1", -12.99, "Netflix International B.V.", null, [plan()]),
    ).toBe("plan-1");
  });

  it("matches when the plan description contains the row text", () => {
    expect(
      findMatchingRecurring("acct-1", -12.99, "Netflix", null, [
        plan({ description: "Netflix subscription" }),
      ]),
    ).toBe("plan-1"); // substring check runs both ways
    expect(
      findMatchingRecurring("acct-1", -12.99, "my Netflix subscription fee", null, [
        plan({ description: "Netflix subscription" }),
      ]),
    ).toBe("plan-1");
  });

  it("matches on the name field too", () => {
    expect(
      findMatchingRecurring("acct-1", -12.99, "monthly charge", "Netflix BV", [plan()]),
    ).toBe("plan-1");
  });

  it("requires the same account", () => {
    expect(
      findMatchingRecurring("acct-2", -12.99, "Netflix", null, [plan()]),
    ).toBeNull();
  });

  it("requires the same direction (expense vs income)", () => {
    expect(
      findMatchingRecurring("acct-1", 12.99, "Netflix", null, [plan()]),
    ).toBeNull();
    expect(
      findMatchingRecurring("acct-1", 2500, "Salary ACME", null, [
        plan({ description: "Salary", amount: 2500, type: "income" }),
      ]),
    ).toBe("plan-1");
  });

  it("skips inactive plans", () => {
    expect(
      findMatchingRecurring("acct-1", -12.99, "Netflix", null, [
        plan({ isActive: false }),
      ]),
    ).toBeNull();
  });

  it("skips plans with an empty description", () => {
    expect(
      findMatchingRecurring("acct-1", -12.99, "Netflix", null, [
        plan({ description: "   " }),
      ]),
    ).toBeNull();
  });

  it("allows ±10% amount tolerance on larger amounts", () => {
    expect(
      findMatchingRecurring("acct-1", -100, "Energie", null, [
        plan({ description: "Energie", amount: 108 }),
      ]),
    ).toBe("plan-1");
    expect(
      findMatchingRecurring("acct-1", -100, "Energie", null, [
        plan({ description: "Energie", amount: 111 }),
      ]),
    ).toBeNull();
  });

  it("allows ±€2 tolerance on small amounts", () => {
    expect(
      findMatchingRecurring("acct-1", -5, "Spotify", null, [
        plan({ description: "Spotify", amount: 6.5 }),
      ]),
    ).toBe("plan-1");
    expect(
      findMatchingRecurring("acct-1", -5, "Spotify", null, [
        plan({ description: "Spotify", amount: 7.5 }),
      ]),
    ).toBeNull();
  });

  it("picks the plan with the closest amount when several match", () => {
    expect(
      findMatchingRecurring("acct-1", -98, "Energie", null, [
        plan({ id: "a", description: "Energie", amount: 95 }),
        plan({ id: "b", description: "Energie", amount: 100 }),
      ]),
    ).toBe("b");
  });

  it("returns null when there are no plans", () => {
    expect(findMatchingRecurring("acct-1", -12.99, "Netflix", null, [])).toBeNull();
  });
});

describe("splitDuplicates", () => {
  const row = (date: string, amount: number, balance: number | null, description: string) => ({
    date,
    amount,
    balance,
    description,
  });

  it("flags rows with matching date/amount/balance even when the description language differs", () => {
    // Real case: overlapping Revolut exports, one Dutch and one English
    const existing = [row("2026-06-09", 276, 826.56, "Overschrijving van LOWIJS CLARIS FITZPAT")];
    const { unique, duplicates } = splitDuplicates(existing, [
      row("2026-06-09", 276, 826.56, "Transfer from LOWIJS CLARIS FITZPATRICK"),
    ]);
    expect(duplicates).toHaveLength(1);
    expect(unique).toHaveLength(0);
  });

  it("keeps same-looking rows when the running balance differs", () => {
    const existing = [row("2026-06-09", -2.99, 17.09, "OVpay")];
    const { unique, duplicates } = splitDuplicates(existing, [
      row("2026-06-09", -2.99, 14.1, "OVpay"),
    ]);
    expect(unique).toHaveLength(1);
    expect(duplicates).toHaveLength(0);
  });

  it("falls back to description matching when the CSV has no balance column", () => {
    const existing = [row("2026-06-09", -2.99, null, "OVpay")];
    const { unique, duplicates } = splitDuplicates(existing, [
      row("2026-06-09", -2.99, null, "ovpay "),
      row("2026-06-09", -5, null, "Albert Heijn"),
    ]);
    expect(duplicates).toHaveLength(1);
    expect(unique).toHaveLength(1);
  });
});
