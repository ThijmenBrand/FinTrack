import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  validatePin,
  getLockoutDuration,
  getClientIp,
  isRateLimited,
  MAX_FAILED_ATTEMPTS,
  MAX_LOCKOUT_CYCLES,
  LOCKOUT_DURATIONS_MS,
} from "./pin-utils";

describe("validatePin", () => {
  it("accepts a normal 4-6 digit PIN", () => {
    expect(validatePin("2580")).toBeNull();
    expect(validatePin("13579")).toBeNull();
    expect(validatePin("192837")).toBeNull();
  });

  it("rejects wrong lengths and non-digits", () => {
    expect(validatePin("123")).toBe("PIN must be 4-6 digits");
    expect(validatePin("1234567")).toBe("PIN must be 4-6 digits");
    expect(validatePin("12a4")).toBe("PIN must be 4-6 digits");
    expect(validatePin("")).toBe("PIN must be 4-6 digits");
  });

  it("rejects repeated-digit PINs", () => {
    for (const pin of ["0000", "99999", "555555"]) {
      expect(validatePin(pin)).toMatch(/too simple/);
    }
  });

  it("rejects well-known trivial PINs", () => {
    for (const pin of ["1234", "123456", "4321", "654321", "0123", "9876"]) {
      expect(validatePin(pin)).toMatch(/too simple/);
    }
  });

  it("rejects any ascending or descending sequence", () => {
    expect(validatePin("2345")).toMatch(/too simple/);
    expect(validatePin("8765")).toMatch(/too simple/);
    expect(validatePin("456789")).toMatch(/too simple/);
  });

  it("accepts non-adjacent sequences", () => {
    expect(validatePin("1357")).toBeNull();
    expect(validatePin("2468")).toBeNull();
  });
});

describe("getLockoutDuration", () => {
  it("escalates 15min → 1h → 24h", () => {
    expect(getLockoutDuration(0)).toBe(15 * 60 * 1000);
    expect(getLockoutDuration(1)).toBe(60 * 60 * 1000);
    expect(getLockoutDuration(2)).toBe(24 * 60 * 60 * 1000);
  });

  it("clamps counts beyond the table to the last entry", () => {
    expect(getLockoutDuration(99)).toBe(
      LOCKOUT_DURATIONS_MS[LOCKOUT_DURATIONS_MS.length - 1],
    );
  });

  it("exports sane lockout constants", () => {
    expect(MAX_FAILED_ATTEMPTS).toBeGreaterThan(0);
    expect(MAX_LOCKOUT_CYCLES).toBe(LOCKOUT_DURATIONS_MS.length);
  });
});

function req(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost:3000/api/test", { headers });
}

describe("getClientIp", () => {
  it("prefers the platform-verified req.ip", () => {
    const r = req({ "x-forwarded-for": "6.6.6.6" });
    Object.assign(r, { ip: "9.9.9.9" });
    expect(getClientIp(r)).toBe("9.9.9.9");
  });

  it("uses the LAST X-Forwarded-For entry (appended by the trusted proxy)", () => {
    expect(getClientIp(req({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" }))).toBe(
      "1.2.3.4",
    );
  });

  it("handles a single XFF entry with whitespace", () => {
    expect(getClientIp(req({ "x-forwarded-for": "  1.2.3.4  " }))).toBe("1.2.3.4");
  });

  it("falls back to X-Real-IP", () => {
    expect(getClientIp(req({ "x-real-ip": "5.5.5.5" }))).toBe("5.5.5.5");
  });

  it("returns a unique unknown-* value when no header is present", () => {
    const a = getClientIp(req());
    const b = getClientIp(req());
    expect(a).toMatch(/^unknown-/);
    expect(a).not.toBe(b); // unique per call so unknowns don't share a bucket
  });
});

describe("isRateLimited", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows the first 5 requests in a minute, blocks the 6th", () => {
    const ip = `test-${crypto.randomUUID()}`;
    for (let i = 0; i < 5; i++) {
      expect(isRateLimited(ip)).toBe(false);
    }
    expect(isRateLimited(ip)).toBe(true);
  });

  it("tracks IPs independently", () => {
    const a = `test-${crypto.randomUUID()}`;
    const b = `test-${crypto.randomUUID()}`;
    for (let i = 0; i < 5; i++) isRateLimited(a);
    expect(isRateLimited(a)).toBe(true);
    expect(isRateLimited(b)).toBe(false);
  });

  it("forgets requests older than the 1-minute window", () => {
    vi.useFakeTimers();
    const ip = `test-${crypto.randomUUID()}`;
    for (let i = 0; i < 6; i++) isRateLimited(ip);
    expect(isRateLimited(ip)).toBe(true);
    vi.advanceTimersByTime(61 * 1000);
    expect(isRateLimited(ip)).toBe(false);
  });
});
