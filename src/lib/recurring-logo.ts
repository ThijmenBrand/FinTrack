import { after } from "next/server";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { recurringTransactions } from "@/db/schema";
import { deleteFile, putFile } from "@/lib/file-store";
import { logoFromName, type FoundLogo } from "@/lib/merchant-logo";

/** `putFile("logos", <planId>, "webp")` keys — the only shape a stored logo may have. */
const LOGO_KEY = /^logos\/[A-Za-z0-9._-]+\.webp$/;

export function isLogoKey(value: string | null | undefined): value is string {
  return typeof value === "string" && LOGO_KEY.test(value);
}

/**
 * `<img src>` for a plan's logo. The key's random suffix rides along as `v`, so
 * the route can cache hard and a replaced logo is a new URL.
 */
export function logoUrl(planId: string, key: string | null): string | null {
  if (!isLogoKey(key)) return null;
  const version = key.slice(key.lastIndexOf("-") + 1, -".webp".length);
  return `/api/recurring/${encodeURIComponent(planId)}/logo?v=${version}`;
}

/**
 * How long a claimed lookup counts as still running. Longer than the two
 * autocomplete calls plus the icon download can take (three fetches of at most
 * 6 s each, redirects included — see `fetchBytes`), so the list keeps polling
 * until the answer is in, and stops soon after a miss.
 */
const LOOKUP_WINDOW_MS = 25_000;

/** True while an automatic lookup is due or under way — the client polls until it isn't. */
export function isLogoPending(
  plan: { logoKey: string | null; logoCheckedAt: string | null },
  now = Date.now(),
): boolean {
  if (plan.logoKey) return false;
  if (!plan.logoCheckedAt) return true;
  return now - Date.parse(plan.logoCheckedAt) < LOOKUP_WINDOW_MS;
}

/** Drop a superseded logo. Never fatal — an orphaned file beats a failed save. */
export async function discardLogo(key: string | null): Promise<void> {
  if (!isLogoKey(key)) return;
  try {
    await deleteFile(key);
  } catch {
    // The row no longer points at it; the leftover is cosmetic.
  }
}

/**
 * Run `remove` — deleting an account or a user, which takes their plans with it
 * by cascade — then drop the logo files of the plans in `scope` that are gone.
 * Checked afterwards rather than assumed: libsql doesn't guarantee
 * `foreign_keys=ON`, so the cascade may not fire, and a plan that survives
 * still needs its file.
 */
export async function discardLogosAfter(
  scope: { userId: string; accountId?: string },
  remove: () => Promise<unknown>,
): Promise<void> {
  const ofUser = eq(recurringTransactions.userId, scope.userId);
  const withLogo = await db
    .select({ id: recurringTransactions.id, logoKey: recurringTransactions.logoKey })
    .from(recurringTransactions)
    .where(
      and(
        ofUser,
        isNotNull(recurringTransactions.logoKey),
        scope.accountId ? eq(recurringTransactions.accountId, scope.accountId) : undefined,
      ),
    );
  await remove();
  if (withLogo.length === 0) return;

  const left = await db
    .select({ id: recurringTransactions.id })
    .from(recurringTransactions)
    .where(and(ofUser, inArray(recurringTransactions.id, withLogo.map((p) => p.id))));
  const kept = new Set(left.map((p) => p.id));
  await Promise.all(withLogo.filter((p) => !kept.has(p.id)).map((p) => discardLogo(p.logoKey)));
}

/**
 * Store `found` as the plan's logo, replacing whatever it had.
 *
 * `claimedAt` is for the automatic lookup: it only lands if the plan is still
 * in the state that lookup claimed. A logo set or removed by hand meanwhile
 * restamps `logoCheckedAt`, and a rename clears it — either way the slower
 * background answer is no longer wanted.
 */
export async function saveLogo(
  planId: string,
  ownerId: string,
  found: FoundLogo,
  claimedAt?: string,
): Promise<string | null> {
  const owned = and(eq(recurringTransactions.id, planId), eq(recurringTransactions.userId, ownerId));
  const [existing] = await db
    .select({ logoKey: recurringTransactions.logoKey })
    .from(recurringTransactions)
    .where(owned)
    .limit(1);
  if (!existing) return null;

  const key = await putFile("logos", planId, "webp", found.bytes);
  const result = await db
    .update(recurringTransactions)
    .set({ logoKey: key, logoSource: found.source, logoCheckedAt: new Date().toISOString() })
    .where(claimedAt ? and(owned, eq(recurringTransactions.logoCheckedAt, claimedAt)) : owned);
  if (result.rowsAffected === 0) {
    // Deleted, or overtaken (see above): the new file has no row to belong to.
    await discardLogo(key);
    return null;
  }
  await discardLogo(existing.logoKey);
  return key;
}

/**
 * Clear the plan's logo. `logoCheckedAt` is stamped rather than cleared, so the
 * automatic lookup doesn't put back the logo that was just taken away.
 */
export async function removeLogo(planId: string, ownerId: string): Promise<void> {
  const [existing] = await db
    .select({ logoKey: recurringTransactions.logoKey })
    .from(recurringTransactions)
    .where(and(eq(recurringTransactions.id, planId), eq(recurringTransactions.userId, ownerId)))
    .limit(1);
  await db
    .update(recurringTransactions)
    .set({ logoKey: null, logoSource: null, logoCheckedAt: new Date().toISOString() })
    .where(and(eq(recurringTransactions.id, planId), eq(recurringTransactions.userId, ownerId)));
  await discardLogo(existing?.logoKey ?? null);
}

/** Lookups started per list read; the rest are claimed by the client's next poll. */
const LOOKUPS_PER_REQUEST = 3;

type LookupCandidate = {
  id: string;
  userId: string;
  description: string;
  logoKey: string | null;
  logoCheckedAt: string | null;
};

/**
 * Find logos for plans that have never been looked up, after the response has
 * gone out. Each plan is claimed first by stamping `logoCheckedAt` only where
 * it is still null, so two overlapping reads can't both fetch (and store) one.
 */
export function scheduleLogoLookups(plans: LookupCandidate[]): void {
  const due = plans.filter((p) => !p.logoKey && !p.logoCheckedAt).slice(0, LOOKUPS_PER_REQUEST);
  if (due.length === 0) return;

  after(async () => {
    await Promise.all(
      due.map(async (plan) => {
        try {
          const claimedAt = new Date().toISOString();
          const claimed = await db
            .update(recurringTransactions)
            .set({ logoCheckedAt: claimedAt })
            .where(
              and(
                eq(recurringTransactions.id, plan.id),
                eq(recurringTransactions.userId, plan.userId),
                isNull(recurringTransactions.logoCheckedAt),
                isNull(recurringTransactions.logoKey),
              ),
            );
          if (claimed.rowsAffected === 0) return;
          const found = await logoFromName(plan.description);
          if (found) await saveLogo(plan.id, plan.userId, found, claimedAt);
        } catch (error) {
          console.error("Recurring logo lookup failed:", error);
        }
      }),
    );
  });
}
