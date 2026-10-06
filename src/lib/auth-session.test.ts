import { describe, it, expect, vi } from "vitest";

// The db/email/i18n imports pull in real connections; the session config we
// assert on is plain data, so stub them out.
vi.mock("@/db/index", () => ({ db: {} }));
vi.mock("@/db/migrate", () => ({ seedCategoriesForUser: vi.fn() }));
vi.mock("@/lib/email", () => ({
  sendVerificationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendOtpEmail: vi.fn(),
}));

describe("session lifetime", () => {
  it("keeps the device signed in for 30 days, refreshed at most daily", async () => {
    const { auth } = await import("@/lib/auth");
    const session = auth.options.session;
    expect(session?.expiresIn).toBe(30 * 24 * 60 * 60);
    expect(session?.updateAge).toBe(24 * 60 * 60);
    // A cookie cache would keep a deleted session working until the cache ran
    // out — including the one the lock screen signs out after too many wrong
    // passwords. Keep every request going to the database.
    expect("cookieCache" in (session ?? {})).toBe(false);
  });
});
