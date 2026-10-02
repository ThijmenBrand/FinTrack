import type { KeyObject } from "node:crypto";
import type { PsuHeaders } from "@/lib/jobs/types";
import { signEnableBankingJwt } from "../crypto/jwt";
import { JobError, bug, retry, userAction } from "../errors";
import {
  parseApplication,
  parseAspsps,
  parseAuthStart,
  parseBalances,
  parseSession,
  parseTransactionsPage,
} from "./validate";

/**
 * Enable Banking API client. One instance per user credential; every request
 * is signed with a freshly minted five-minute JWT from that user's key.
 *
 * Network hygiene, because this is the only code that talks to the outside:
 *  - one hardcoded HTTPS host; nothing in a request URL comes from the
 *    provider except ids that are path-encoded
 *  - default TLS verification, redirects refused (`redirect: "error"`)
 *  - 15 s timeout, 5 MB response cap
 *  - errors become typed JobErrors with a stable code; provider error bodies
 *    are never logged or stored (they can echo account data)
 */

export const ENABLE_BANKING_API = "https://api.enablebanking.com";

const TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class EnableBankingClient {
  constructor(
    private readonly opts: {
      appId: string;
      privateKey: KeyObject;
      fetch?: FetchLike;
      now?: () => number;
    },
  ) {}

  async getApplication() {
    return parseApplication(await this.request("GET", "/application", { notFound: "app_not_found" }));
  }

  async listAspsps(country: string) {
    const q = new URLSearchParams({ country, psu_type: "personal", service: "AIS" });
    return parseAspsps(await this.request("GET", `/aspsps?${q}`));
  }

  async startAuth(input: {
    aspspName: string;
    aspspCountry: string;
    state: string;
    redirectUrl: string;
    validUntil: Date;
  }) {
    return parseAuthStart(
      await this.request("POST", "/auth", {
        body: {
          access: { valid_until: input.validUntil.toISOString() },
          aspsp: { name: input.aspspName, country: input.aspspCountry },
          state: input.state,
          redirect_url: input.redirectUrl,
          psu_type: "personal",
        },
      }),
    );
  }

  async createSession(code: string) {
    return parseSession(await this.request("POST", "/sessions", { body: { code } }));
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request("DELETE", `/sessions/${encodeURIComponent(sessionId)}`, {
      // Already gone is what we wanted.
      allowNotFound: true,
    });
  }

  async getTransactions(
    accountUid: string,
    query: { dateFrom: string; continuationKey?: string | null },
    psu?: PsuHeaders,
  ) {
    const q = new URLSearchParams({ date_from: query.dateFrom, transaction_status: "BOOK" });
    if (query.continuationKey) q.set("continuation_key", query.continuationKey);
    return parseTransactionsPage(
      await this.request("GET", `/accounts/${encodeURIComponent(accountUid)}/transactions?${q}`, {
        psu,
        notFound: "account_gone",
      }),
    );
  }

  async getBalances(accountUid: string, psu?: PsuHeaders) {
    return parseBalances(
      await this.request("GET", `/accounts/${encodeURIComponent(accountUid)}/balances`, {
        psu,
        notFound: "account_gone",
      }),
    );
  }

  private async request(
    method: "GET" | "POST" | "DELETE",
    path: string,
    opts: {
      body?: unknown;
      psu?: PsuHeaders;
      notFound?: "app_not_found" | "account_gone";
      allowNotFound?: boolean;
    } = {},
  ): Promise<unknown> {
    const jwt = signEnableBankingJwt({
      appId: this.opts.appId,
      privateKey: this.opts.privateKey,
      now: this.opts.now?.(),
    });
    const headers: Record<string, string> = {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/json",
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    // Attended request: the user is present, so the bank's unattended quota
    // (often 4 a day) doesn't apply.
    if (opts.psu) {
      headers["Psu-Ip-Address"] = opts.psu.ip;
      headers["Psu-User-Agent"] = opts.psu.userAgent.slice(0, 500);
    }

    const doFetch = this.opts.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(`${ENABLE_BANKING_API}${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw retry("timeout", "Enable Banking did not answer in time");
      }
      throw retry("network", "Could not reach Enable Banking");
    }

    const text = await readCapped(res);
    if (res.ok) {
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch {
        throw bug("invalid_response", "Enable Banking sent malformed JSON");
      }
    }
    if (res.status === 404 && opts.allowNotFound) return {};
    throw classifyHttpError(res, text, opts.notFound, this.opts.now?.() ?? Date.now());
  }
}

async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_RESPONSE_BYTES) {
    await res.body?.cancel();
    throw bug("invalid_response", "Enable Banking response too large");
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw bug("invalid_response", "Enable Banking response too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The provider's own error code ("EXPIRED_SESSION", …) when it sent one. */
function providerCode(text: string): string {
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    const code = body.error ?? body.code;
    return typeof code === "string" ? code.toUpperCase().slice(0, 100) : "";
  } catch {
    return "";
  }
}

export function classifyHttpError(
  res: Response,
  text: string,
  notFound: "app_not_found" | "account_gone" | undefined,
  now: number,
): JobError {
  const code = providerCode(text);
  if (res.status === 429 || /RATE_LIMIT/.test(code)) {
    const retryAfter = Number(res.headers.get("retry-after"));
    // Without a hint, wait for the next background window rather than hammer.
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 6 * 3_600_000;
    return new JobError("rate_limited", "rate_limited", "Rate limited by the bank", now + Math.min(wait, 24 * 3_600_000));
  }
  if (/EXPIRED/.test(code)) return userAction("consent_expired", "Bank consent has expired");
  if (/REVOKED|CLOSED_SESSION|SESSION_DOES_NOT_EXIST|NO_SESSION|INVALID_SESSION/.test(code)) {
    return userAction("consent_revoked", "Bank consent is no longer valid");
  }
  if (res.status === 401) return userAction("key_rejected", "Enable Banking rejected the application key");
  if (res.status === 403) {
    return /SESSION|ACCESS|CONSENT/.test(code)
      ? userAction("consent_revoked", "The bank refused access")
      : userAction("key_rejected", "Enable Banking refused the application");
  }
  if (res.status === 404) {
    return notFound ? userAction(notFound, "Not found at Enable Banking") : bug("not_found", "Unexpected 404");
  }
  if (res.status >= 500 || res.status === 408) {
    return retry("provider_unavailable", `Enable Banking returned ${res.status}`);
  }
  // Remaining 4xx: we sent something the provider didn't accept. A bug.
  return bug("invalid_response", `Enable Banking returned ${res.status}${code ? ` (${code})` : ""}`);
}
