import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { validateCsrfOrigin } from "./csrf";

function post(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost:3000/api/test", {
    method: "POST",
    headers,
  });
}

describe("validateCsrfOrigin", () => {
  beforeEach(() => {
    // Make the trusted-origin set deterministic regardless of the shell env.
    vi.stubEnv("BETTER_AUTH_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("VERCEL_URL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows a trusted origin from BETTER_AUTH_URL", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://app.example.com");
    expect(validateCsrfOrigin(post({ origin: "https://app.example.com" }))).toBeNull();
  });

  it("normalizes BETTER_AUTH_URL to its origin (path stripped)", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://app.example.com/api/auth");
    expect(validateCsrfOrigin(post({ origin: "https://app.example.com" }))).toBeNull();
  });

  it("rejects an untrusted origin with 403", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://app.example.com");
    const res = validateCsrfOrigin(post({ origin: "https://evil.com" }));
    expect(res?.status).toBe(403);
    await expect(res!.json()).resolves.toEqual({
      error: "Forbidden: untrusted origin",
    });
  });

  it("rejects a scheme/subdomain mismatch", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://app.example.com");
    expect(validateCsrfOrigin(post({ origin: "http://app.example.com" }))?.status).toBe(403);
    expect(validateCsrfOrigin(post({ origin: "https://evil.app.example.com" }))?.status).toBe(403);
  });

  it("falls back to localhost:3000 when no env is configured", () => {
    expect(validateCsrfOrigin(post({ origin: "http://localhost:3000" }))).toBeNull();
    expect(validateCsrfOrigin(post({ origin: "https://evil.com" }))?.status).toBe(403);
  });

  it("trusts VERCEL_PROJECT_PRODUCTION_URL and VERCEL_URL as https origins", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "fintrack.example.com");
    vi.stubEnv("VERCEL_URL", "fintrack-git-abc.vercel.app");
    expect(validateCsrfOrigin(post({ origin: "https://fintrack.example.com" }))).toBeNull();
    expect(validateCsrfOrigin(post({ origin: "https://fintrack-git-abc.vercel.app" }))).toBeNull();
  });

  it("allows a missing Origin only when Sec-Fetch-Site confirms same-origin", () => {
    expect(validateCsrfOrigin(post({ "sec-fetch-site": "same-origin" }))).toBeNull();
    expect(validateCsrfOrigin(post({ "sec-fetch-site": "none" }))).toBeNull();
  });

  it("rejects a missing Origin with cross-site or absent Sec-Fetch-Site", async () => {
    expect(validateCsrfOrigin(post({ "sec-fetch-site": "cross-site" }))?.status).toBe(403);
    expect(validateCsrfOrigin(post({ "sec-fetch-site": "same-site" }))?.status).toBe(403);
    const res = validateCsrfOrigin(post());
    expect(res?.status).toBe(403);
    await expect(res!.json()).resolves.toEqual({
      error: "Forbidden: missing origin",
    });
  });
});
