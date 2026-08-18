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

describe("session idle timeout", () => {
  it("dies after 1h of inactivity and slides on every request", async () => {
    const { auth } = await import("@/lib/auth");
    const session = auth.options.session;
    expect(session?.expiresIn).toBe(60 * 60);
    // updateAge 0 = re-issue the expiry on every request that hits the db,
    // so an active user is never logged out mid-use.
    expect(session?.updateAge).toBe(0);
    // A cookie cache would serve requests without touching the db, and those
    // requests would not slide the window. Keep it off.
    expect("cookieCache" in (session ?? {})).toBe(false);
  });
});
