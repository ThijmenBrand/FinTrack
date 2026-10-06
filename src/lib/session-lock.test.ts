import { describe, it, expect, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

import { isLockExempt, lockState, LOCK_AFTER_MS, TOUCH_EVERY_MS } from "./session-lock";
import { unlockPath } from "./unlock-path";

const NOW = Date.parse("2026-10-06T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms);

describe("lockState", () => {
  it("stays unlocked while used within the hour", () => {
    expect(lockState(ago(LOCK_AFTER_MS - 1), ago(LOCK_AFTER_MS * 10), NOW).locked).toBe(false);
  });

  it("locks an hour after the last activity", () => {
    expect(lockState(ago(LOCK_AFTER_MS), ago(LOCK_AFTER_MS * 10), NOW)).toEqual({
      locked: true,
      touch: false,
    });
  });

  it("counts from sign-in when there is no activity yet", () => {
    expect(lockState(null, ago(5_000), NOW)).toEqual({ locked: false, touch: true });
    expect(lockState(null, ago(LOCK_AFTER_MS + 1), NOW).locked).toBe(true);
  });

  it("only asks for an activity write once a minute", () => {
    const created = ago(LOCK_AFTER_MS * 2);
    expect(lockState(ago(TOUCH_EVERY_MS - 1), created, NOW).touch).toBe(false);
    expect(lockState(ago(TOUCH_EVERY_MS), created, NOW).touch).toBe(true);
  });

  it("locks when the timestamp can't be read", () => {
    expect(lockState(new Date(Number.NaN), ago(0), NOW).locked).toBe(true);
  });
});

describe("isLockExempt", () => {
  it.each([
    ["/unlock", "GET"],
    ["/api/unlock", "GET"],
    ["/api/unlock/passkey", "POST"],
    ["/api/auth/sign-out", "POST"],
    ["/api/auth/verify-email", "GET"],
    ["/api/avatar/avatars/u1-abc.webp", "GET"],
    ["/manifest.json", "GET"],
  ])("lets a locked session reach %s", (path, method) => {
    expect(isLockExempt(path, method)).toBe(true);
  });

  it.each([
    ["/", "GET"],
    ["/unlocked-looking-path", "GET"],
    ["/api/transactions", "GET"],
    ["/api/auth/get-session", "GET"],
    ["/api/auth/passkey/generate-register-options", "GET"],
    ["/api/auth/update-user", "POST"],
    ["/api/step-up/passkey/options", "POST"],
    ["/api/avatar/avatars/u1-abc.webp", "DELETE"],
  ])("holds %s back while locked", (path, method) => {
    expect(isLockExempt(path, method)).toBe(false);
  });
});

describe("unlockPath", () => {
  it("returns to where the user was", () => {
    expect(unlockPath("/transactions?q=albert heijn")).toBe(
      "/unlock?redirect=%2Ftransactions%3Fq%3Dalbert%20heijn",
    );
    expect(unlockPath("/")).toBe("/unlock");
  });
});
