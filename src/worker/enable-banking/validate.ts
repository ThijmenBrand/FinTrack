import { bug } from "../errors";

/**
 * Hand-written validators for Enable Banking responses. Everything the bank
 * sends is untrusted input: these check the shape we rely on, coerce nothing
 * silently, and drop every field we don't use. A response that doesn't fit is
 * an `invalid_response` bug (dead-letter queue), never half-processed data.
 */

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function fail(what: string): never {
  throw bug("invalid_response", `Unexpected provider response: ${what}`);
}

function obj(v: unknown, what: string): Obj {
  if (!isObj(v)) fail(what);
  return v;
}

function str(v: unknown, what: string, max = 2000): string {
  if (typeof v !== "string" || v.length > max) fail(what);
  return v;
}

function optStr(v: unknown, what: string, max = 2000): string | null {
  if (v === undefined || v === null) return null;
  return str(v, what, max);
}

function arr(v: unknown, what: string, max = 10_000): unknown[] {
  if (!Array.isArray(v) || v.length > max) fail(what);
  return v;
}

// ─── /application ────────────────────────────────────────────────────────

export interface EbApplication {
  environment: "SANDBOX" | "PRODUCTION";
  redirectUrls: string[];
  active: boolean;
}

export function parseApplication(body: unknown): EbApplication {
  const o = obj(body, "application");
  const environment = str(o.environment, "application.environment", 32);
  if (environment !== "SANDBOX" && environment !== "PRODUCTION") fail("application.environment");
  return {
    environment,
    redirectUrls: arr(o.redirect_urls ?? [], "application.redirect_urls", 100).map((u) =>
      str(u, "application.redirect_urls[]"),
    ),
    active: o.active === undefined ? true : o.active === true,
  };
}

// ─── /aspsps ─────────────────────────────────────────────────────────────

export interface EbAspsp {
  name: string;
  country: string;
  /** Seconds, when the bank publishes a cap. */
  maximumConsentValidity: number | null;
  psuTypes: string[];
}

export function parseAspsps(body: unknown): EbAspsp[] {
  const o = obj(body, "aspsps");
  return arr(o.aspsps, "aspsps.aspsps", 10_000).map((raw) => {
    const a = obj(raw, "aspsp");
    const mcv = a.maximum_consent_validity;
    return {
      name: str(a.name, "aspsp.name", 200),
      country: str(a.country, "aspsp.country", 2),
      maximumConsentValidity: typeof mcv === "number" && Number.isFinite(mcv) && mcv > 0 ? mcv : null,
      psuTypes: Array.isArray(a.psu_types)
        ? a.psu_types.filter((t): t is string => typeof t === "string").slice(0, 10)
        : [],
    };
  });
}

// ─── POST /auth ──────────────────────────────────────────────────────────

export function parseAuthStart(body: unknown): { url: string } {
  const o = obj(body, "auth");
  const url = str(o.url, "auth.url", 4000);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail("auth.url");
  }
  // We send the user's browser there: https only, nothing else.
  if (parsed.protocol !== "https:") fail("auth.url protocol");
  return { url: parsed.toString() };
}

// ─── POST /sessions ──────────────────────────────────────────────────────

export interface EbSessionAccount {
  uid: string;
  iban: string | null;
  name: string | null;
  currency: string | null;
}

export interface EbSession {
  sessionId: string;
  validUntil: string | null;
  accounts: EbSessionAccount[];
}

export function parseSession(body: unknown): EbSession {
  const o = obj(body, "session");
  const validUntil = isObj(o.access) ? optStr(o.access.valid_until, "session.access.valid_until", 64) : null;
  if (validUntil && Number.isNaN(Date.parse(validUntil))) fail("session.access.valid_until");
  return {
    sessionId: str(o.session_id, "session.session_id", 200),
    validUntil: validUntil ? new Date(validUntil).toISOString() : null,
    accounts: arr(o.accounts ?? [], "session.accounts", 200).map((raw) => {
      const a = obj(raw, "session.account");
      const accountId = isObj(a.account_id) ? a.account_id : {};
      return {
        uid: str(a.uid, "session.account.uid", 200),
        iban: optStr(accountId.iban, "session.account.iban", 64),
        name: optStr(a.name, "session.account.name", 200),
        currency: optStr(a.currency, "session.account.currency", 3),
      };
    }),
  };
}

// ─── /accounts/{uid}/transactions ────────────────────────────────────────

/** A provider transaction, still raw-ish: strings as sent, structure checked. */
export interface EbTransaction {
  entryReference: string | null;
  amount: string;
  currency: string;
  creditDebit: "CRDT" | "DBIT" | null;
  status: string | null;
  bookingDate: string | null;
  valueDate: string | null;
  transactionDate: string | null;
  creditorName: string | null;
  creditorIban: string | null;
  debtorName: string | null;
  debtorIban: string | null;
  remittance: string[];
  balanceAfter: { amount: string; currency: string | null } | null;
}

function party(v: unknown): string | null {
  return isObj(v) && typeof v.name === "string" ? v.name.slice(0, 500) : null;
}

function partyIban(v: unknown): string | null {
  return isObj(v) && typeof v.iban === "string" ? v.iban.slice(0, 64) : null;
}

function amountObj(v: unknown, what: string): { amount: string; currency: string | null } {
  const a = obj(v, what);
  const amount = a.amount;
  const asText = typeof amount === "number" ? String(amount) : amount;
  if (typeof asText !== "string" || asText.length > 40) fail(`${what}.amount`);
  return { amount: asText, currency: optStr(a.currency, `${what}.currency`, 3) };
}

export function parseTransactionsPage(body: unknown): {
  transactions: EbTransaction[];
  continuationKey: string | null;
} {
  const o = obj(body, "transactions");
  const transactions = arr(o.transactions ?? [], "transactions.transactions", 5000).map((raw): EbTransaction => {
    const t = obj(raw, "transaction");
    const amount = amountObj(t.transaction_amount, "transaction.transaction_amount");
    if (!amount.currency) fail("transaction.transaction_amount.currency");
    const cdi = t.credit_debit_indicator;
    const balanceRaw = t.balance_after_transaction;
    let balanceAfter: EbTransaction["balanceAfter"] = null;
    if (isObj(balanceRaw)) {
      // Seen both flat ({amount, currency}) and nested ({balance_amount: …}).
      const inner = isObj(balanceRaw.balance_amount) ? balanceRaw.balance_amount : balanceRaw;
      if (inner.amount !== undefined) balanceAfter = amountObj(inner, "transaction.balance_after_transaction");
    }
    const remittance = Array.isArray(t.remittance_information)
      ? t.remittance_information.filter((r): r is string => typeof r === "string").slice(0, 20)
      : typeof t.remittance_information === "string"
        ? [t.remittance_information]
        : [];
    return {
      entryReference: optStr(t.entry_reference, "transaction.entry_reference", 500),
      amount: amount.amount,
      currency: amount.currency,
      creditDebit: cdi === "CRDT" || cdi === "DBIT" ? cdi : null,
      status: optStr(t.status, "transaction.status", 16),
      bookingDate: optStr(t.booking_date, "transaction.booking_date", 32),
      valueDate: optStr(t.value_date, "transaction.value_date", 32),
      transactionDate: optStr(t.transaction_date, "transaction.transaction_date", 32),
      creditorName: party(t.creditor),
      creditorIban: partyIban(t.creditor_account),
      debtorName: party(t.debtor),
      debtorIban: partyIban(t.debtor_account),
      remittance,
      balanceAfter,
    };
  });
  return {
    transactions,
    continuationKey: optStr(o.continuation_key, "transactions.continuation_key", 2000) || null,
  };
}

// ─── /accounts/{uid}/balances ────────────────────────────────────────────

export interface EbBalance {
  amount: string;
  currency: string | null;
  type: string | null;
}

export function parseBalances(body: unknown): EbBalance[] {
  const o = obj(body, "balances");
  return arr(o.balances ?? [], "balances.balances", 100).map((raw) => {
    const b = obj(raw, "balance");
    const amount = amountObj(b.balance_amount, "balance.balance_amount");
    return { ...amount, type: optStr(b.balance_type, "balance.balance_type", 16) };
  });
}
