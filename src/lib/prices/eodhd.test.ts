/**
 * The provider client, against payloads EODHD actually returned.
 *
 * The search and EOD fixtures below are real responses recorded on
 * 2026-11-22 for IE00B4L5Y983 (iShares Core MSCI World) — trimmed, but not
 * reshaped. Hand-written fixtures would only ever prove the parser agrees
 * with itself; these pin it to the field names and quirks the service really
 * sends, including the `warning` row the free plan appends.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { setupTestDb } from "../test-db";

const testDb = await setupTestDb("eodhd-client");

const { searchListings, fetchDailyCloses, PriceProviderError, isConfigured } =
  await import("./eodhd");

/** Six listings of ONE ISIN, in four currencies. Verbatim field names. */
const SEARCH = [
  { Code: "IWDA", Exchange: "LSE", Name: "iShares Core MSCI World UCITS ETF USD (Acc)", Type: "ETF", Country: "UK", Currency: "USD", ISIN: "IE00B4L5Y983", isPrimary: false, previousClose: 134.79, previousCloseDate: "2026-11-20" },
  { Code: "EUNL", Exchange: "XETRA", Name: "iShares Core MSCI World UCITS ETF USD (Acc) EUR", Type: "ETF", Country: "Germany", Currency: "EUR", ISIN: "IE00B4L5Y983", isPrimary: false, previousClose: 122.715, previousCloseDate: "2026-11-20" },
  { Code: "IWDA", Exchange: "AS", Name: "iShares Core MSCI World UCITS ETF USD (Acc)", Type: "ETF", Country: "Netherlands", Currency: "EUR", ISIN: "IE00B4L5Y983", isPrimary: false, previousClose: 122.71, previousCloseDate: "2026-11-20" },
  { Code: "SWDA", Exchange: "SW", Name: "iShares Core MSCI World UCITS ETF USD (Acc) USD", Type: "ETF", Country: "Switzerland", Currency: "USD", ISIN: "IE00B4L5Y983", isPrimary: false, previousClose: 134.82, previousCloseDate: "2026-11-20" },
  { Code: "SWDA", Exchange: "LSE", Name: "iShares Core MSCI World UCITS ETF USD (Acc)", Type: "ETF", Country: "UK", Currency: "GBX", ISIN: "IE00B4L5Y983", isPrimary: false, previousClose: 10288, previousCloseDate: "2026-11-20" },
  { Code: "EUNL", Exchange: "F", Name: "iShares Core MSCI World UCITS ETF USD (Acc)", Type: "ETF", Country: "Germany", Currency: "EUR", ISIN: "IE00B4L5Y983", isPrimary: false, previousClose: 120.48, previousCloseDate: "2026-11-20" },
];

/** The free plan appends a `warning` to the final row. */
const EOD = [
  { date: "2025-11-24", open: 108.875, high: 109.68, low: 108.305, close: 109.535, adjusted_close: 109.535, volume: 103576 },
  { date: "2026-11-20", open: 124.34, high: 124.99, low: 122.71, close: 122.71, adjusted_close: 122.71, volume: 260178, warning: "Data is limited by one year as you have free subscription" },
];

function respond(body: unknown, status = 200) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

afterAll(() => testDb.cleanup());
beforeEach(async () => {
  await testDb.reset();
  process.env.EODHD_API_TOKEN = "test-token";
});

describe("searchListings", () => {
  it("reads the real field names", async () => {
    const listings = await searchListings("IE00B4L5Y983", {
      fetchImpl: respond(SEARCH),
    });
    expect(listings).toHaveLength(6);
    expect(listings[2]).toEqual({
      symbol: "IWDA.AS",
      name: "iShares Core MSCI World UCITS ETF USD (Acc)",
      exchange: "AS",
      currency: "EUR",
      isin: "IE00B4L5Y983",
      country: "Netherlands",
      type: "ETF",
      previousClose: 122.71,
    });
  });

  it("keeps every currency a listing trades in", async () => {
    const listings = await searchListings("IE00B4L5Y983", {
      fetchImpl: respond(SEARCH),
    });
    // One ISIN, four currencies — including GBX, where the quote is in pence
    // and is 84x the euro figure. Picking automatically would be a disaster;
    // the client's job is to hand all of them over intact.
    expect(new Set(listings.map((l) => l.currency))).toEqual(
      new Set(["USD", "EUR", "GBX"]),
    );
    expect(listings.find((l) => l.symbol === "SWDA.LSE")?.previousClose).toBe(10288);
  });

  it("drops a row with no code rather than inventing a symbol", async () => {
    const listings = await searchListings("x", {
      fetchImpl: respond([{ Name: "Nameless", Currency: "EUR" }, SEARCH[2]]),
    });
    expect(listings.map((l) => l.symbol)).toEqual(["IWDA.AS"]);
  });

  it("never calls an unlabelled listing euros", async () => {
    // EUR is the one value the dialog reads as "nothing to warn about", so a
    // listing the provider did not label must not borrow it.
    const [listing] = await searchListings("x", {
      fetchImpl: respond([{ Code: "AAA", Exchange: "US", Name: "Unlabelled" }]),
    });
    expect(listing.currency).not.toBe("EUR");
  });
});

describe("fetchDailyCloses", () => {
  it("takes the close and ignores the free plan's warning field", async () => {
    const closes = await fetchDailyCloses("IWDA.AS", "2025-11-22", {
      fetchImpl: respond(EOD),
    });
    expect(closes).toEqual([
      { date: "2025-11-24", close: 109.535 },
      { date: "2026-11-20", close: 122.71 },
    ]);
  });

  it("takes the printed close, not the adjusted one", async () => {
    const closes = await fetchDailyCloses("X.AS", "2026-01-01", {
      fetchImpl: respond([
        { date: "2026-11-20", close: 100, adjusted_close: 42 },
      ]),
    });
    // Valuing a position asks what the units were worth on the day, which is
    // the price the market printed — not a figure restated for later splits.
    expect(closes[0].close).toBe(100);
  });

  it("skips a row with no usable price", async () => {
    const closes = await fetchDailyCloses("X.AS", "2026-01-01", {
      fetchImpl: respond([
        { date: "2026-11-19", close: null },
        { date: "2026-11-20", close: 0 },
        { date: "2026-11-21", close: 5 },
      ]),
    });
    expect(closes).toEqual([{ date: "2026-11-21", close: 5 }]);
  });
});

describe("error mapping", () => {
  const cases: [number, string][] = [
    [402, "budget_exhausted"],
    [429, "budget_exhausted"],
    [401, "key_rejected"],
    [403, "key_rejected"],
    [404, "not_found"],
    [500, "provider_unavailable"],
  ];

  for (const [status, code] of cases) {
    it(`maps ${status} to ${code}`, async () => {
      await expect(
        fetchDailyCloses("X.AS", "2026-01-01", { fetchImpl: respond("", status) }),
      ).rejects.toMatchObject({ code });
    });
  }

  it("refuses to call at all without a token", async () => {
    delete process.env.EODHD_API_TOKEN;
    expect(isConfigured()).toBe(false);
    const fetchImpl = respond(EOD);
    await expect(
      fetchDailyCloses("X.AS", "2026-01-01", { fetchImpl }),
    ).rejects.toBeInstanceOf(PriceProviderError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
