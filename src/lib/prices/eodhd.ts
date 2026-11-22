/**
 * The EODHD client: resolve an ISIN to a listing, and fetch daily closes.
 *
 * Two endpoints, deliberately. A portfolio tracker needs a *closing price per
 * date*, which is exactly what the EOD endpoint returns — and it returns the
 * whole requested range in a single call, so backfilling five years of history
 * costs the same one call as asking for yesterday. That fact is what makes a
 * 20-call-a-day plan workable: the budget is spent per instrument, never per
 * day of history.
 *
 * Nothing here touches the database or decides policy. It reserves a call,
 * makes it, and maps the answer — so the refresh logic can be tested without a
 * network and this can be tested without a schema.
 */
import { spend, type Caller } from "./budget";

const BASE = "https://eodhd.com/api";

/** Stable codes, so callers never match on a provider's prose. */
export type PriceErrorCode =
  | "not_configured"
  | "budget_exhausted"
  | "key_rejected"
  | "not_found"
  | "provider_unavailable"
  | "invalid_response";

export class PriceProviderError extends Error {
  constructor(
    readonly code: PriceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PriceProviderError";
  }
}

/** One tradeable listing of a security: the same fund on a given exchange. */
export interface Listing {
  /** `IWDA.AS` — what every later price call is keyed by. */
  symbol: string;
  name: string;
  exchange: string;
  /** The currency this *listing* trades in, which differs between venues. */
  currency: string;
  isin: string | null;
  country: string | null;
  type: string | null;
  previousClose: number | null;
}

export interface DailyClose {
  date: string;
  close: number;
}

export interface ClientOptions {
  token?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
  /** Skips the budget. Only for a caller that has already reserved. */
  prepaid?: boolean;
}

function token(opts: ClientOptions): string {
  const t = opts.token ?? process.env.EODHD_API_TOKEN;
  if (!t) {
    throw new PriceProviderError(
      "not_configured",
      "EODHD_API_TOKEN is not set — prices stay manual",
    );
  }
  return t;
}

/**
 * Reserve, call, classify.
 *
 * The reservation happens before the request leaves, and is not refunded when
 * the provider answers with an error: a rejected call still counted against
 * the plan. Refunding it here would let a misconfigured token burn the day's
 * budget in a retry loop while the counter insisted nothing had been spent.
 */
async function get(
  path: string,
  params: Record<string, string>,
  caller: Caller,
  opts: ClientOptions,
): Promise<unknown> {
  const auth = token(opts);

  if (!opts.prepaid) {
    const reservation = await spend(1, caller, { now: opts.now });
    if (!reservation.ok) {
      throw new PriceProviderError(
        "budget_exhausted",
        `Daily EODHD call budget spent (${reservation.used} used)`,
      );
    }
  }

  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_token", auth);
  url.searchParams.set("fmt", "json");

  let response: Response;
  try {
    response = await (opts.fetchImpl ?? fetch)(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (cause) {
    throw new PriceProviderError(
      "provider_unavailable",
      `EODHD unreachable: ${cause instanceof Error ? cause.name : "unknown"}`,
    );
  }

  if (!response.ok) throw classify(response.status);

  try {
    return await response.json();
  } catch {
    throw new PriceProviderError("invalid_response", "EODHD returned non-JSON");
  }
}

function classify(status: number): PriceProviderError {
  // 402 is the plan's own "you have had your 20"; 429 is the per-minute limit.
  if (status === 402 || status === 429) {
    return new PriceProviderError("budget_exhausted", `EODHD refused: ${status}`);
  }
  if (status === 401 || status === 403) {
    return new PriceProviderError("key_rejected", `EODHD rejected the token: ${status}`);
  }
  if (status === 404) {
    return new PriceProviderError("not_found", "EODHD knows no such symbol");
  }
  return new PriceProviderError("provider_unavailable", `EODHD error: ${status}`);
}

/**
 * Listings matching an ISIN (or a name, or a ticker — the endpoint takes any).
 *
 * Always interactive: it exists to put a choice in front of a person. The same
 * fund lists in Amsterdam in EUR and in London in USD, and picking for them
 * would silently denominate their portfolio in a currency they do not hold.
 */
export async function searchListings(
  query: string,
  opts: ClientOptions = {},
): Promise<Listing[]> {
  const raw = await get(
    `search/${encodeURIComponent(query)}`,
    { limit: "20" },
    "interactive",
    opts,
  );
  if (!Array.isArray(raw)) {
    throw new PriceProviderError("invalid_response", "Search did not return a list");
  }
  return raw.flatMap((row) => {
    const r = row as Record<string, unknown>;
    const code = str(r.Code);
    const exchange = str(r.Exchange);
    if (!code || !exchange) return [];
    return [
      {
        symbol: `${code}.${exchange}`,
        name: str(r.Name) ?? code,
        exchange,
        // Never defaulted to EUR. "EUR" is the one value that tells the UI
        // there is nothing to warn about, so claiming it for a listing the
        // provider did not label would hide the exact mistake the warning is
        // there to catch. An unlabelled listing fails the link route's check
        // instead, which is the right outcome: it cannot be valued safely.
        currency: str(r.Currency)?.toUpperCase() ?? "?",
        isin: str(r.ISIN),
        country: str(r.Country),
        type: str(r.Type),
        previousClose: num(r.previousClose),
      },
    ];
  });
}

/**
 * Daily closes for one listing, from `from` to the latest available.
 *
 * One call regardless of the range — which is why the refresh asks only for
 * the days it is missing, and the backfill asks for everything at once.
 */
export async function fetchDailyCloses(
  symbol: string,
  from: string,
  opts: ClientOptions & { caller?: Caller } = {},
): Promise<DailyClose[]> {
  const raw = await get(
    `eod/${encodeURIComponent(symbol)}`,
    { from, period: "d", order: "a" },
    opts.caller ?? "background",
    opts,
  );
  if (!Array.isArray(raw)) {
    throw new PriceProviderError("invalid_response", "EOD did not return a list");
  }
  return raw.flatMap((row) => {
    const r = row as Record<string, unknown>;
    const date = str(r.date);
    // The unadjusted close, on purpose. `adjusted_close` restates history for
    // splits and dividends, which is right for measuring performance and wrong
    // for valuing a position: what the units were worth on the day is the
    // price the market printed that day.
    const close = num(r.close);
    if (!date || close === null || close <= 0) return [];
    return [{ date, close }];
  });
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** True once a token exists — the UI hides the lookup entirely without one. */
export function isConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.EODHD_API_TOKEN;
}
