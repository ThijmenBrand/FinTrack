import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { withUser } from "@/lib/auth";
import {
  PriceProviderError,
  isConfigured,
  searchListings,
  type Listing,
} from "@/lib/prices/eodhd";
import { remainingFor } from "@/lib/prices/budget";

/**
 * GET /api/instruments/search?q=IE00B4L5Y983 — listings matching an ISIN.
 *
 * Costs one call from a plan that allows twenty a day, so it is never fired
 * while someone types. The dialog asks for it on an explicit "look up", and
 * the response carries what is left of the budget so the UI can say so rather
 * than let the next click fail.
 */
export async function GET(request: NextRequest) {
  return withUser(async () => {
    if (!isConfigured()) return apiError("api.priceProviderUnconfigured", 503);

    const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
    // An ISIN is 12 characters; a ticker or name is short too. The bound is
    // here so a pasted document cannot become a provider request.
    if (q.length < 2 || q.length > 80) return apiError("api.invalidSearch", 400);

    try {
      const listings = await searchListings(q);
      return NextResponse.json({
        listings: rank(listings),
        remaining: await remainingFor("interactive"),
      });
    } catch (error) {
      if (!(error instanceof PriceProviderError)) throw error;
      if (error.code === "budget_exhausted") {
        return apiError("api.priceBudgetSpent", 429);
      }
      if (error.code === "key_rejected") {
        return apiError("api.priceProviderUnconfigured", 503);
      }
      // No match is an answer, not a failure — and the budget figure has to
      // stay true, or the dialog would announce that no lookups are left.
      if (error.code === "not_found") {
        return NextResponse.json({
          listings: [],
          remaining: await remainingFor("interactive"),
        });
      }
      return apiError("api.priceProviderUnavailable", 502);
    }
  }, "Failed to search instruments");
}

/**
 * Euro listings first.
 *
 * The same UCITS fund lists in Amsterdam in EUR and in London in USD, and this
 * app has no FX conversion: a portfolio priced from the London line would read
 * as euros while holding dollars. Ordering does not prevent that — the user
 * still chooses — but it puts the listing that is almost always right on top.
 */
function rank(listings: Listing[]): Listing[] {
  return [...listings].sort((a, b) => {
    const euro = Number(b.currency === "EUR") - Number(a.currency === "EUR");
    if (euro !== 0) return euro;
    return a.symbol.localeCompare(b.symbol);
  });
}
