import { NextRequest } from "next/server";

// ─── PIN validation ─────────────────────────────────────────────────────────

const TRIVIAL_PINS = [
  "0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999",
  "00000", "11111", "22222", "33333", "44444", "55555", "66666", "77777", "88888", "99999",
  "000000", "111111", "222222", "333333", "444444", "555555", "666666", "777777", "888888", "999999",
  "1234", "12345", "123456", "4321", "54321", "654321",
  "0123", "01234", "012345",
  "9876", "98765", "987654",
];

function isSequential(pin: string): boolean {
  const digits = pin.split("").map(Number);
  let ascending = true;
  let descending = true;
  for (let i = 1; i < digits.length; i++) {
    if (digits[i] !== digits[i - 1] + 1) ascending = false;
    if (digits[i] !== digits[i - 1] - 1) descending = false;
  }
  return ascending || descending;
}

export function validatePin(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) {
    return "PIN must be 4-6 digits";
  }
  if (TRIVIAL_PINS.includes(pin) || isSequential(pin)) {
    return "PIN is too simple. Avoid sequential or repeating digits.";
  }
  return null;
}

// ─── Lockout constants ──────────────────────────────────────────────────────

export const MAX_FAILED_ATTEMPTS = 5;

export const MAX_LOCKOUT_CYCLES = 3;
export const LOCKOUT_DURATIONS_MS = [
  15 * 60 * 1000,      // 1st lockout: 15 minutes
  60 * 60 * 1000,      // 2nd lockout: 1 hour
  24 * 60 * 60 * 1000, // 3rd lockout: 24 hours
];
export function getLockoutDuration(lockoutCount: number): number {
  return LOCKOUT_DURATIONS_MS[Math.min(lockoutCount, LOCKOUT_DURATIONS_MS.length - 1)];
}

// ─── IP-based rate limiter ──────────────────────────────────────────────────

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 5;

const ipRequestMap = new Map<string, number[]>();
let lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // clean every 5 minutes

/**
 * Extract the client IP using the platform-verified source to prevent
 * X-Forwarded-For spoofing. Priority:
 * 1. req.ip — set by Next.js / Vercel from the actual connecting IP
 * 2. Last entry in X-Forwarded-For — appended by the trusted edge proxy
 * 3. X-Real-IP / fallback
 */
export function getClientIp(req: NextRequest): string {
  // req.ip is set by Next.js/Vercel at runtime but not in the base type
  const ip = (req as NextRequest & { ip?: string }).ip;
  if (ip) return ip;

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }

  return req.headers.get("x-real-ip") || `unknown-${crypto.randomUUID()}`;
}

export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;

  // Lazy cleanup: sweep stale entries periodically instead of using setInterval
  if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
    for (const [key, ts] of ipRequestMap) {
      const valid = ts.filter((t) => t > cutoff);
      if (valid.length === 0) ipRequestMap.delete(key);
      else ipRequestMap.set(key, valid);
    }
    lastCleanup = now;
  }

  const timestamps = (ipRequestMap.get(ip) || []).filter((t) => t > cutoff);
  timestamps.push(now);
  ipRequestMap.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT_MAX_REQUESTS;
}
