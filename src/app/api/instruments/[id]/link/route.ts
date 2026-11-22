import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import { instruments, trades } from "@/db/schema";
import { and, eq, min } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import {
  PriceProviderError,
  fetchDailyCloses,
  isConfigured,
} from "@/lib/prices/eodhd";
import { storeCloses } from "@/lib/prices/refresh";
import { logDataEvent } from "@/lib/audit";
import type { MessageKey } from "@/lib/i18n/translate";

/** A provider symbol: `IWDA.AS`. Bounded, and never interpolated into SQL. */
const SYMBOL = /^[A-Za-z0-9._-]{1,24}\.[A-Za-z]{1,8}$/;
const CURRENCY = /^[A-Z]{3}$/;

/**
 * POST /api/instruments/[id]/link — point an instrument at a provider listing
 * and fill in its history.
 *
 * The backfill runs here, inline, because it is one call: the EOD endpoint
 * returns the whole requested range at once, so fetching every close since the
 * first trade costs exactly what fetching yesterday's would. Deferring it to
 * the nightly job would save nothing and leave the chart empty until tomorrow.
 *
 * History starts at the first trade rather than at some fixed number of years:
 * prices from before the fund was owned value nothing, and the rows would sit
 * in the table forever.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withUser(async (userId) => {
    if (!isConfigured()) return apiError("api.priceProviderUnconfigured", 503);

    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const symbol = typeof body.symbol === "string" ? body.symbol.trim() : "";
    const currency =
      typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "";

    if (!SYMBOL.test(symbol) || !CURRENCY.test(currency)) {
      return apiError("api.invalidInstrument", 400);
    }

    const [owned] = await db
      .select({ id: instruments.id })
      .from(instruments)
      .where(and(eq(instruments.id, id), eq(instruments.userId, userId)))
      .limit(1);
    if (!owned) return apiError("api.instrumentNotFound", 404);

    const [firstTrade] = await db
      .select({ date: min(trades.date) })
      .from(trades)
      .where(and(eq(trades.userId, userId), eq(trades.instrumentId, id)));

    try {
      // The user is waiting on this, so it draws from the interactive share of
      // the budget rather than the background one.
      const rows = await fetchDailyCloses(symbol, firstTrade?.date ?? "2000-01-01", {
        caller: "interactive",
      });

      await db
        .update(instruments)
        .set({ symbol, currency, dataSource: "eodhd" })
        .where(and(eq(instruments.id, id), eq(instruments.userId, userId)));

      const written = await storeCloses(db, userId, id, rows);

      logDataEvent({
        userId,
        action: "account_update",
        targetId: id,
        targetType: "account",
        details: { linkedSymbol: symbol, prices: written },
      });

      return NextResponse.json({ symbol, currency, prices: written });
    } catch (error) {
      if (!(error instanceof PriceProviderError)) throw error;
      const codes: Record<string, [MessageKey, number]> = {
        budget_exhausted: ["api.priceBudgetSpent", 429],
        key_rejected: ["api.priceProviderUnconfigured", 503],
        not_found: ["api.instrumentNotFound", 404],
      };
      const [key, status] = codes[error.code] ?? ["api.priceProviderUnavailable", 502];
      return apiError(key, status);
    }
  }, "Failed to link instrument");
}
