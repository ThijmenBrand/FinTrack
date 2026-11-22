import { db } from "@/db";
import { PriceProviderError } from "@/lib/prices/eodhd";
import { refreshPrices } from "@/lib/prices/refresh";
import { retry, userAction } from "../errors";
import type { Handler } from "./types";

/**
 * Fetch today's closes for one user's holdings.
 *
 * Deliberately not retried on a spent budget. The queue's instinct is to back
 * off and try again, but the plan resets at 00:00 GMT and every attempt before
 * then gets the same refusal — so an exhausted budget ends the job quietly and
 * tomorrow's scheduled run picks the work up. Retrying would spend the
 * per-minute limit to learn nothing.
 */
export const refreshPricesHandler: Handler<"prices.refresh"> = async (_payload, ctx) => {
  try {
    const outcome = await refreshPrices(db, ctx.userId);
    return outcome;
  } catch (error) {
    if (!(error instanceof PriceProviderError)) throw error;
    switch (error.code) {
      case "not_configured":
      case "key_rejected":
        // The operator has to fix the token; no retry will help.
        throw userAction("key_rejected", error.message);
      case "provider_unavailable":
        throw retry("provider_unavailable", error.message);
      default:
        throw retry("network", error.message);
    }
  }
};
