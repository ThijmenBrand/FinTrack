import { describe, it, expect } from "vitest";
import { cleanText, normalizeTransactions, parseDecimal, pickBalance } from "./normalize";
import type { EbTransaction } from "../enable-banking/validate";

function tx(o: Partial<EbTransaction> = {}): EbTransaction {
  return {
    entryReference: "ref-1",
    amount: "12.50",
    currency: "EUR",
    creditDebit: "DBIT",
    status: "BOOK",
    bookingDate: "2026-09-03",
    valueDate: null,
    transactionDate: null,
    creditorName: "Albert Heijn",
    creditorIban: "NL01 BANK 0000 0000 01",
    debtorName: "Me",
    debtorIban: "NL99BANK0000000099",
    remittance: ["AH 1234", "Amsterdam"],
    balanceAfter: { amount: "987.50", currency: "EUR" },
    ...o,
  };
}

describe("normalizeTransactions", () => {
  it("signs by the indicator and takes the counterparty from the right side", () => {
    const { rows } = normalizeTransactions(
      [tx(), tx({ entryReference: "ref-2", creditDebit: "CRDT", amount: "1500", remittance: ["Salary"] })],
      "EUR",
    );
    expect(rows[0]).toEqual({
      date: "2026-09-03",
      name: "Albert Heijn",
      description: "AH 1234 Amsterdam",
      amount: -12.5,
      balance: 987.5,
      counterpartyIban: "NL01BANK0000000001",
      externalId: "ref:ref-1",
    });
    expect(rows[1]).toMatchObject({ amount: 1500, name: "Me", counterpartyIban: "NL99BANK0000000099" });
  });

  it("skips pending, foreign-currency and nonsensical rows, and counts them", () => {
    const { rows, skipped } = normalizeTransactions(
      [
        tx({ status: "PDNG" }),
        tx({ currency: "USD" }),
        tx({ amount: "1e5" }),
        tx({ amount: "0" }),
        tx({ bookingDate: "2026-02-30" }),
        tx({ bookingDate: null, valueDate: "2026-09-04" }),
      ],
      "EUR",
    );
    expect(skipped).toEqual({ pending: 1, currency: 1, invalid: 3 });
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe("2026-09-04");
  });

  it("gives identical reference-less rows distinct, stable ids", () => {
    const coffee = tx({ entryReference: null, amount: "3.00", remittance: ["Coffee"] });
    const first = normalizeTransactions([coffee, coffee], "EUR").rows.map((r) => r.externalId);
    const again = normalizeTransactions([coffee, coffee], "EUR").rows.map((r) => r.externalId);
    expect(first[0]).not.toBe(first[1]);
    expect(first).toEqual(again);
    expect(first[0]).toMatch(/^h:[A-Za-z0-9_-]{32}:1$/);
  });

  it("falls back to the name when there is no remittance text", () => {
    const { rows } = normalizeTransactions([tx({ remittance: [] })], "EUR");
    expect(rows[0].description).toBe("Albert Heijn");
  });

  it("ignores a balance in another currency", () => {
    const { rows } = normalizeTransactions([tx({ balanceAfter: { amount: "1", currency: "USD" } })], "EUR");
    expect(rows[0].balance).toBeNull();
  });
});

describe("cleanText", () => {
  it("strips control and bidi-override characters and caps length", () => {
    const rlo = String.fromCharCode(0x202e);
    const zwsp = String.fromCharCode(0x200b);
    const nul = String.fromCharCode(0);
    expect(cleanText(`Evil${rlo}gnp.exe${zwsp}${nul}  x`, 100)).toBe("Evil gnp.exe x");
    expect(cleanText("a".repeat(300), 200)).toHaveLength(200);
    expect(cleanText("   ", 10)).toBeNull();
  });
});

describe("parseDecimal", () => {
  it("accepts plain decimals only", () => {
    expect(parseDecimal("12.34")).toBe(12.34);
    expect(parseDecimal("-0.5")).toBe(-0.5);
    for (const bad of ["1e3", "12,34", "NaN", "Infinity", "", "1.123456789", "9999999999999"]) {
      expect(parseDecimal(bad)).toBeNull();
    }
  });
});

describe("pickBalance", () => {
  it("prefers the booked closing balance", () => {
    expect(
      pickBalance(
        [
          { amount: "50", currency: "EUR", type: "ITAV" },
          { amount: "40", currency: "EUR", type: "CLBD" },
          { amount: "1", currency: "USD", type: "CLBD" },
        ],
        "EUR",
      ),
    ).toBe(40);
    expect(pickBalance([], "EUR")).toBeNull();
  });
});
