/**
 * Validation for the things a person types about holdings.
 *
 * Kept out of the route handlers so the rules are testable on their own and
 * cannot drift between the create and update paths.
 */
import { isFiniteNumber, isIsoDate, validateName } from "@/lib/validation";

export const ASSET_CLASSES = [
  "equity",
  "bond",
  "cash",
  "commodity",
  "real_estate",
  "crypto",
  "other",
] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export const TRADE_TYPES = ["buy", "sell", "dividend", "fee"] as const;
export type TradeType = (typeof TRADE_TYPES)[number];

export function isAssetClass(v: unknown): v is AssetClass {
  return typeof v === "string" && (ASSET_CLASSES as readonly string[]).includes(v);
}

export function isTradeType(v: unknown): v is TradeType {
  return typeof v === "string" && (TRADE_TYPES as readonly string[]).includes(v);
}

/**
 * An ISIN is 12 characters: two letters, nine alphanumerics, a check digit.
 * Shape only — the check digit is not verified, because a typo there is the
 * user's to notice and refusing a valid-but-unusual code would be worse.
 */
export function normalizeIsin(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(trimmed) ? trimmed : null;
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

export interface InstrumentInput {
  name: string;
  isin: string | null;
  symbol: string | null;
  currency: string;
  assetClass: AssetClass;
}

export function checkInstrument(body: Record<string, unknown>): Checked<InstrumentInput> {
  const name = validateName(body.name);
  if (!name.ok) return { ok: false, error: name.error };
  if (body.isin != null && body.isin !== "" && normalizeIsin(body.isin) === null) {
    return { ok: false, error: "api.invalidIsin" };
  }
  if (body.assetClass !== undefined && !isAssetClass(body.assetClass)) {
    return { ok: false, error: "api.invalidAssetClass" };
  }
  const symbol =
    typeof body.symbol === "string" && body.symbol.trim() !== ""
      ? body.symbol.trim().toUpperCase().slice(0, 32)
      : null;
  return {
    ok: true,
    value: {
      name: name.value,
      isin: body.isin ? normalizeIsin(body.isin) : null,
      symbol,
      currency:
        typeof body.currency === "string" && /^[A-Z]{3}$/.test(body.currency)
          ? body.currency
          : "EUR",
      assetClass: isAssetClass(body.assetClass) ? body.assetClass : "equity",
    },
  };
}

export interface TradeInput {
  instrumentId: string;
  date: string;
  type: TradeType;
  quantity: number;
  unitPrice: number;
  fee: number;
}

/**
 * What each trade type needs, which is not the same for all four.
 *
 * A buy or sell is a quantity at a price. A dividend is a total with no
 * quantity. A fee is just a fee. Requiring quantity on all of them would make
 * people type zeroes, and accepting it on all of them would let a fee carry a
 * quantity that silently never gets counted.
 */
export function checkTrade(
  body: Record<string, unknown>,
  today: string,
): Checked<TradeInput> {
  if (typeof body.instrumentId !== "string" || body.instrumentId === "") {
    return { ok: false, error: "api.instrumentRequired" };
  }
  if (!isTradeType(body.type)) return { ok: false, error: "api.invalidTradeType" };
  if (!isIsoDate(body.date)) return { ok: false, error: "api.invalidTradeDate" };
  if (body.date > today) return { ok: false, error: "api.tradeInFuture" };

  const fee = body.fee === undefined || body.fee === null ? 0 : body.fee;
  if (!isFiniteNumber(fee) || fee < 0) return { ok: false, error: "api.invalidTrade" };

  const quantity = body.quantity ?? 0;
  const unitPrice = body.unitPrice ?? 0;
  if (!isFiniteNumber(quantity) || !isFiniteNumber(unitPrice)) {
    return { ok: false, error: "api.invalidTrade" };
  }
  if (quantity < 0 || unitPrice < 0) {
    // Direction is carried by `type`, never by a sign. A negative quantity on
    // a buy would be a sell nobody asked for.
    return { ok: false, error: "api.invalidTrade" };
  }
  if ((body.type === "buy" || body.type === "sell") && quantity <= 0) {
    return { ok: false, error: "api.quantityRequired" };
  }
  if (body.type === "dividend" && unitPrice <= 0) {
    return { ok: false, error: "api.amountRequired" };
  }
  if (body.type === "fee" && fee <= 0) {
    return { ok: false, error: "api.feeRequired" };
  }

  return {
    ok: true,
    value: {
      instrumentId: body.instrumentId,
      date: body.date,
      type: body.type,
      quantity: body.type === "buy" || body.type === "sell" ? quantity : 0,
      unitPrice: body.type === "fee" ? 0 : unitPrice,
      fee,
    },
  };
}

export function checkPrice(
  body: Record<string, unknown>,
  today: string,
): Checked<{ date: string; price: number }> {
  if (!isIsoDate(body.date)) return { ok: false, error: "api.invalidPriceDate" };
  if (body.date > today) return { ok: false, error: "api.priceInFuture" };
  if (!isFiniteNumber(body.price) || body.price < 0) {
    return { ok: false, error: "api.invalidPrice" };
  }
  return { ok: true, value: { date: body.date, price: body.price } };
}
