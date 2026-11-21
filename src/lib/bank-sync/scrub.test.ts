import { describe, it, expect } from "vitest";
import { scrubEvent, scrubText } from "./scrub";

describe("scrubText", () => {
  it.each([
    ["GET https://app/settings/bank-connections/callback?state=abc123&code=xyz", "state=[redacted]&code=[redacted]"],
    ["Bearer eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJ4In0.c2lnbmF0dXJl", "Bearer [token]"],
    ["token eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJ4In0.c2lnbmF0dXJl here", "[jwt]"],
    ["iban NL91 ABNA 0417 1643 00 and NL91ABNA0417164300", "iban [iban] and [iban]"],
    ["https://api.enablebanking.com/accounts/0f2c1d9e-1/transactions", "/accounts/[id]/transactions"],
    ["-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----", "[pem]"],
    ["v1:QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo", "[sealed]"],
  ])("redacts %#", (input, expected) => {
    expect(scrubText(input)).toContain(expected);
  });

  it("leaves ordinary text alone", () => {
    expect(scrubText("Failed to commit import")).toBe("Failed to commit import");
  });
});

describe("scrubEvent", () => {
  it("walks nested events and drops sensitive headers", () => {
    const event = {
      message: "sync failed for NL91ABNA0417164300",
      request: { url: "https://x/cb?code=secret", headers: { authorization: "Bearer abc", "user-agent": "ok" } },
      breadcrumbs: [{ data: { url: "https://api.enablebanking.com/sessions/123-abc" } }],
    };
    const out = scrubEvent(event);
    expect(JSON.stringify(out)).not.toMatch(/NL91ABNA|secret|Bearer abc|123-abc/);
    expect(out.request.headers["user-agent"]).toBe("ok");
  });

  it("redacts dotted span attribute keys, as SDK v11 emits them", () => {
    const span = {
      name: "GET /settings/bank-connections/callback",
      attributes: {
        "http.request.header.authorization": "Bearer abc",
        "http.request.header.cookie": "session=zzz",
        "url.query": "code=secret&state=xyz",
        "http.request.header.user-agent": "ok",
        "server.address": "api.enablebanking.com",
      },
    };
    const out = scrubEvent(span);
    expect(out.attributes["http.request.header.authorization"]).toBe("[redacted]");
    expect(out.attributes["http.request.header.cookie"]).toBe("[redacted]");
    expect(JSON.stringify(out)).not.toMatch(/Bearer abc|session=zzz|secret|xyz/);
    // Non-sensitive attributes keep their values.
    expect(out.attributes["http.request.header.user-agent"]).toBe("ok");
    expect(out.attributes["server.address"]).toBe("api.enablebanking.com");
  });
  it("redacts app-wide secret names, hyphenated and x- prefixed alike", () => {
    // The dotted-key match above and the widened name list meet here: a header
    // spelled `x-api-key` arrives as the last segment of a span attribute, and
    // the same secret is `api_key` in a JSON body. Both have to go.
    const span: { attributes: Record<string, unknown> } = {
      attributes: {
        "http.request.header.x-api-key": "sk-live-1",
        "http.request.header.x-reset-token": "live-token",
        "http.request.body.password": "hunter2",
        "db.statement.api_key": "sk-live-2",
        "http.request.header.user-agent": "ok",
        "server.address": "api.example.com",
        "http.response.status_code": 500,
      },
    };
    const out = scrubEvent(span);
    for (const key of [
      "http.request.header.x-api-key",
      "http.request.header.x-reset-token",
      "http.request.body.password",
      "db.statement.api_key",
    ]) {
      expect(out.attributes[key]).toBe("[redacted]");
    }
    expect(JSON.stringify(out)).not.toMatch(/sk-live-1|sk-live-2|live-token|hunter2/);
    // Everything that makes a trace worth reading survives.
    expect(out.attributes["http.request.header.user-agent"]).toBe("ok");
    expect(out.attributes["server.address"]).toBe("api.example.com");
    expect(out.attributes["http.response.status_code"]).toBe(500);
  });

  it("drops objects past the depth cutoff instead of passing them through", () => {
    // Without this the subtree was returned as it was: a secret nested deeply
    // enough rode out to Sentry unscrubbed.
    let deep: Record<string, unknown> = { password: "hunter2" };
    for (let i = 0; i < 12; i++) deep = { nested: deep };
    expect(JSON.stringify(scrubEvent(deep))).not.toMatch(/hunter2/);
  });
});
