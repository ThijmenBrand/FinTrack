import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { EnableBankingClient, classifyHttpError } from "./client";
import { parseAuthStart, parseTransactionsPage } from "./validate";
import { JobError } from "../errors";

const res = (status: number, headers: Record<string, string> = {}) => new Response(null, { status, headers });

describe("classifyHttpError", () => {
  const now = Date.UTC(2026, 9, 2);
  it.each([
    [res(429, { "retry-after": "120" }), "", "rate_limited", "rate_limited"],
    [res(400), '{"error":"ASPSP_RATE_LIMIT_EXCEEDED"}', "rate_limited", "rate_limited"],
    [res(400), '{"error":"EXPIRED_SESSION"}', "user_action", "consent_expired"],
    [res(422), '{"error":"REVOKED_SESSION"}', "user_action", "consent_revoked"],
    [res(401), "", "user_action", "key_rejected"],
    [res(503), "", "retry", "provider_unavailable"],
    [res(400), '{"error":"WRONG_FIELD"}', "bug", "invalid_response"],
  ])("maps %#", (r, body, kind, code) => {
    const err = classifyHttpError(r, body, undefined, now);
    expect(err.kind).toBe(kind);
    expect(err.code).toBe(code);
  });

  it("honours Retry-After", () => {
    const err = classifyHttpError(res(429, { "retry-after": "120" }), "", undefined, 1000);
    expect(err.retryAt).toBe(1000 + 120_000);
  });

  it("maps 404 to the caller's notion of gone", () => {
    expect(classifyHttpError(res(404), "", "account_gone", 0).code).toBe("account_gone");
  });
});

describe("validators", () => {
  it("only lets the browser go to an https bank URL", () => {
    expect(parseAuthStart({ url: "https://bank.example/x" }).url).toBe("https://bank.example/x");
    for (const url of ["http://bank.example", "javascript:alert(1)", "data:text/html,x", "not a url"]) {
      expect(() => parseAuthStart({ url })).toThrow(JobError);
    }
  });

  it("rejects a malformed transaction page", () => {
    expect(() => parseTransactionsPage({ transactions: [{ transaction_amount: { amount: "1" } }] })).toThrow(JobError);
    expect(() => parseTransactionsPage({ transactions: "nope" })).toThrow(JobError);
  });
});

describe("EnableBankingClient", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  it("turns a network failure into a retryable error and never follows redirects", async () => {
    let seen: RequestInit | undefined;
    const client = new EnableBankingClient({
      appId: "app",
      privateKey,
      fetch: async (_url, init) => {
        seen = init;
        throw new TypeError("fetch failed");
      },
    });
    await expect(client.getApplication()).rejects.toMatchObject({ kind: "retry", code: "network" });
    expect(seen?.redirect).toBe("error");
  });

  it("refuses an oversized response", async () => {
    const client = new EnableBankingClient({
      appId: "app",
      privateKey,
      fetch: async () => new Response("{}", { status: 200, headers: { "content-length": String(10 * 1024 * 1024) } }),
    });
    await expect(client.getApplication()).rejects.toMatchObject({ kind: "bug", code: "invalid_response" });
  });

  it("path-encodes provider ids", async () => {
    let url = "";
    const client = new EnableBankingClient({
      appId: "app",
      privateKey,
      fetch: async (u) => {
        url = u;
        return new Response('{"balances":[]}', { status: 200 });
      },
    });
    await client.getBalances("../../application");
    expect(url).toBe("https://api.enablebanking.com/accounts/..%2F..%2Fapplication/balances");
  });
});
