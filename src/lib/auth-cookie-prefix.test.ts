import { describe, it, expect, afterEach, vi } from "vitest";

/** The prefix is read once at module load, so each case needs a fresh import. */
async function load(prefix?: string) {
  vi.resetModules();
  vi.stubEnv("AUTH_COOKIE_PREFIX", prefix ?? "");
  return import("./auth-cookie-prefix");
}

describe("auth cookie prefix", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults to better-auth, so an existing session keeps its cookie", async () => {
    const { AUTH_COOKIE_PREFIX, authCookieNames } = await load();
    expect(AUTH_COOKIE_PREFIX).toBe("better-auth");
    expect(authCookieNames()).toContain("better-auth.session_token");
  });

  it("names every cookie after a configured prefix", async () => {
    const { authCookieNames } = await load("fintrack-wt2");
    expect(authCookieNames()).toEqual([
      "fintrack-wt2.session_token",
      "__Secure-fintrack-wt2.session_token",
      "fintrack-wt2.session_data",
      "__Secure-fintrack-wt2.session_data",
    ]);
  });

  it("ignores surrounding whitespace, and an empty value", async () => {
    expect((await load("  wt2  ")).AUTH_COOKIE_PREFIX).toBe("wt2");
    expect((await load("   ")).AUTH_COOKIE_PREFIX).toBe("better-auth");
  });

  it("refuses a prefix no browser would send back", async () => {
    // A space or a separator yields a cookie the browser drops — a login that
    // never sticks, with nothing in the logs to say why.
    await expect(load("wt 2")).rejects.toThrow(/AUTH_COOKIE_PREFIX/);
    await expect(load("wt=2")).rejects.toThrow(/AUTH_COOKIE_PREFIX/);
  });
});
