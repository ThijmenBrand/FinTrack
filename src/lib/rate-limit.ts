/**
 * Fixed-window per-key rate limiter, in process memory.
 *
 * Resets on a cold start, and each serverless instance counts separately — so
 * this stops one session from hammering an expensive route, not a distributed
 * attacker. Routes that need to key off the caller rather than the session use
 * `isRateLimited` in ./pin-utils, which uses the platform-verified IP.
 *
 * ponytail: fixed window, not a sliding one — a caller can burst 2x the limit
 * across a window boundary. Swap for a token bucket if that ever matters.
 */
export function createRateLimiter(windowMs: number, max: number) {
  const entries = new Map<string, { count: number; resetAt: number }>();

  return function allow(key: string): boolean {
    const now = Date.now();
    const entry = entries.get(key);

    if (!entry || now >= entry.resetAt) {
      // Expired entries are only overwritten, never deleted, so the map would
      // grow one key per user forever. Drop the dead ones whenever it gets big.
      if (entries.size > 10_000) {
        for (const [k, v] of entries) if (now >= v.resetAt) entries.delete(k);
      }
      entries.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }

    if (entry.count >= max) return false;
    entry.count++;
    return true;
  };
}
