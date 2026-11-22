/**
 * Position arithmetic.
 *
 * These are the numbers a person will check against their broker's own
 * statement, so the awkward cases matter more than the happy one: fees folded
 * into cost, a partial sale leaving the average price alone, dividends that
 * must NOT look like a discount on the purchase, and a full sale that leaves
 * float crumbs behind rather than a clean zero.
 *
 * Cost basis is average cost, not FIFO. The tests say so in their numbers.
 */
import { describe, it, expect } from "vitest";
import {
  cashAtBroker,
  derivePositions,
  portfolioValue,
  priceAsOf,
  valuePositions,
  valuationDatesFor,
  type TradeRow,
} from "@/lib/positions";

const buy = (date: string, quantity: number, unitPrice: number, fee = 0): TradeRow => ({
  instrumentId: "etf",
  date,
  type: "buy",
  quantity,
  unitPrice,
  fee,
});
const sell = (date: string, quantity: number, unitPrice: number, fee = 0): TradeRow => ({
  instrumentId: "etf",
  date,
  type: "sell",
  quantity,
  unitPrice,
  fee,
});
const dividend = (date: string, amount: number, fee = 0): TradeRow => ({
  instrumentId: "etf",
  date,
  type: "dividend",
  quantity: 0,
  unitPrice: amount,
  fee,
});
const charge = (date: string, fee: number): TradeRow => ({
  instrumentId: "etf",
  date,
  type: "fee",
  quantity: 0,
  unitPrice: 0,
  fee,
});

const one = (trades: TradeRow[]) => derivePositions(trades).get("etf")!;

describe("buying", () => {
  it("counts the fee as part of what the units cost", () => {
    const p = one([buy("2026-01-01", 10, 100, 5)]);
    expect(p.quantity).toBe(10);
    expect(p.costBasis).toBe(1_005);
    expect(p.averagePrice).toBeCloseTo(100.5, 10);
  });

  it("averages two buys at different prices", () => {
    const p = one([buy("2026-01-01", 10, 100), buy("2026-02-01", 10, 120)]);
    expect(p.quantity).toBe(20);
    expect(p.costBasis).toBe(2_200);
    expect(p.averagePrice).toBe(110);
  });
});

describe("selling", () => {
  it("removes cost in proportion and leaves the average price alone", () => {
    const p = one([
      buy("2026-01-01", 10, 100),
      buy("2026-02-01", 10, 120),
      sell("2026-03-01", 5, 150),
    ]);
    expect(p.quantity).toBe(15);
    // Average cost: 5 units left at 110 each, so 550 comes off a basis of 2200.
    expect(p.costBasis).toBe(1_650);
    expect(p.averagePrice).toBe(110);
    // Realized: sold 5 at 150 that had cost 110 each.
    expect(p.realized).toBe(200);
  });

  it("is average cost, not FIFO", () => {
    // FIFO would realize 5 x (150 - 100) = 250 by selling the first lot.
    const p = one([
      buy("2026-01-01", 10, 100),
      buy("2026-02-01", 10, 120),
      sell("2026-03-01", 5, 150),
    ]);
    expect(p.realized).toBe(200);
    expect(p.realized).not.toBe(250);
  });

  it("takes the sale fee out of the proceeds", () => {
    const p = one([buy("2026-01-01", 10, 100), sell("2026-02-01", 10, 110, 7)]);
    expect(p.realized).toBe(93);
  });

  it("closes a holding cleanly rather than leaving float dust", () => {
    const p = one([buy("2026-01-01", 0.3, 100), buy("2026-02-01", 0.6, 100), sell("2026-03-01", 0.9, 100)]);
    expect(p.quantity).toBe(0);
    expect(p.costBasis).toBe(0);
    expect(p.averagePrice).toBeNull();
  });

  it("never lets a holding go negative", () => {
    const p = one([buy("2026-01-01", 5, 100), sell("2026-02-01", 50, 100)]);
    expect(p.quantity).toBe(0);
    // Only the 5 actually held were sold, so only their gain is realized.
    expect(p.realized).toBe(0);
  });

  it("uses the average price at the time of the sale, not the final one", () => {
    const p = one([
      buy("2026-01-01", 10, 100),
      sell("2026-02-01", 5, 150),
      // A later, pricier buy must not change what February realized.
      buy("2026-03-01", 10, 300),
    ]);
    expect(p.realized).toBe(250);
  });

  it("walks trades in date order however they arrive", () => {
    const inOrder = one([buy("2026-01-01", 10, 100), sell("2026-02-01", 5, 150)]);
    const shuffled = one([sell("2026-02-01", 5, 150), buy("2026-01-01", 10, 100)]);
    expect(shuffled.realized).toBe(inOrder.realized);
    expect(shuffled.costBasis).toBe(inOrder.costBasis);
  });
});

describe("dividends and fees", () => {
  it("counts a dividend as income, not as a discount on the purchase", () => {
    const p = one([buy("2026-01-01", 10, 100), dividend("2026-06-01", 42)]);
    expect(p.dividends).toBe(42);
    // The holding still cost what it cost.
    expect(p.costBasis).toBe(1_000);
    expect(p.averagePrice).toBe(100);
  });

  it("nets withholding off a dividend", () => {
    const p = one([buy("2026-01-01", 10, 100), dividend("2026-06-01", 50, 7.5)]);
    expect(p.dividends).toBe(42.5);
  });

  it("treats a standalone fee as money lost", () => {
    const p = one([buy("2026-01-01", 10, 100), charge("2026-06-01", 25)]);
    expect(p.fees).toBe(25);
    expect(p.realized).toBe(-25);
    expect(p.costBasis).toBe(1_000);
  });
});

describe("valuing", () => {
  const prices = new Map([
    [
      "etf",
      [
        { date: "2026-01-31", price: 105 },
        { date: "2026-03-31", price: 130 },
      ],
    ],
  ]);

  it("carries the last price forward", () => {
    const [v] = valuePositions(derivePositions([buy("2026-01-01", 10, 100)]), prices, "2026-02-15");
    expect(v.price).toBe(105);
    expect(v.priceDate).toBe("2026-01-31");
    expect(v.marketValue).toBe(1_050);
    expect(v.unrealized).toBe(50);
  });

  it("is null before any price, rather than falling back to cost", () => {
    const [v] = valuePositions(derivePositions([buy("2026-01-01", 10, 100)]), prices, "2026-01-15");
    expect(v.price).toBeNull();
    expect(v.marketValue).toBeNull();
    expect(v.unrealized).toBeNull();
    expect(v.totalReturn).toBeNull();
  });

  it("adds banked profit and dividends into the total return", () => {
    const trades = [buy("2026-01-01", 20, 100), sell("2026-02-01", 10, 150), dividend("2026-02-15", 30)];
    const [v] = valuePositions(derivePositions(trades), prices, "2026-03-31");
    expect(v.unrealized).toBe(300); // 10 units at 130, cost 1000
    expect(v.realized).toBe(500);
    expect(v.dividends).toBe(30);
    expect(v.totalReturn).toBe(830);
  });
});

describe("priceAsOf", () => {
  const prices = [
    { date: "2026-01-31", price: 105 },
    { date: "2026-03-31", price: 130 },
  ];

  it("picks the newest price on or before the date", () => {
    expect(priceAsOf(prices, "2026-03-31")?.price).toBe(130);
    expect(priceAsOf(prices, "2026-03-30")?.price).toBe(105);
  });

  it("is null before the first price", () => {
    expect(priceAsOf(prices, "2026-01-30")).toBeNull();
    expect(priceAsOf([], "2026-03-31")).toBeNull();
  });
});

describe("portfolioValue", () => {
  const priced = new Map([["etf", [{ date: "2026-01-01", price: 10 }]]]);

  it("adds up the open positions", () => {
    const valued = valuePositions(derivePositions([buy("2026-01-01", 10, 9)]), priced, "2026-02-01");
    expect(portfolioValue(valued)).toBe(100);
  });

  it("is zero once everything has been sold, not null", () => {
    const trades = [buy("2026-01-01", 10, 9), sell("2026-01-05", 10, 11)];
    const valued = valuePositions(derivePositions(trades), priced, "2026-02-01");
    // Nothing is held, so the account holds nothing — a real zero, unlike an
    // unpriced holding, which is an unknown.
    expect(portfolioValue(valued)).toBe(0);
  });

  it("is null while nothing held has a price", () => {
    const valued = valuePositions(derivePositions([buy("2026-06-01", 10, 9)]), new Map(), "2026-06-02");
    expect(portfolioValue(valued)).toBeNull();
  });
});

describe("valuationDatesFor", () => {
  it("merges trade and price dates, sorted and deduplicated", () => {
    expect(
      valuationDatesFor(
        [{ date: "2026-02-01" }, { date: "2026-01-01" }],
        [{ date: "2026-02-01" }, { date: "2026-03-01" }],
      ),
    ).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });
});

describe("cashAtBroker", () => {
  const paid = [
    { date: "2026-01-05", amount: 400 },
    { date: "2026-02-05", amount: 400 },
    { date: "2026-03-05", amount: 400 },
  ];

  it("is what arrived minus what the trades spent", () => {
    const trades = [buy("2026-02-10", 5, 100, 2)];
    // 800 in by 10 February, 502 spent on the buy.
    expect(cashAtBroker(paid, trades, "2026-02-10")).toBe(298);
  });

  it("counts only what had arrived by the date", () => {
    expect(cashAtBroker(paid, [], "2026-01-31")).toBe(400);
    expect(cashAtBroker(paid, [], "2026-03-31")).toBe(1_200);
  });

  it("gives a sale and a dividend back as cash", () => {
    const trades = [buy("2026-01-10", 4, 100), sell("2026-02-10", 2, 150), dividend("2026-03-10", 20)];
    // 1200 in, 400 spent, 300 back, 20 dividend.
    expect(cashAtBroker(paid, trades, "2026-03-31")).toBe(1_120);
  });

  it("clamps at zero rather than showing the account in debt", () => {
    // Trades entered before the transfers that funded them were imported.
    expect(cashAtBroker([], [buy("2026-01-10", 10, 100)], "2026-01-31")).toBe(0);
  });

  it("takes a standalone fee out of the cash", () => {
    expect(cashAtBroker(paid, [charge("2026-01-20", 15)], "2026-01-31")).toBe(385);
  });
});
