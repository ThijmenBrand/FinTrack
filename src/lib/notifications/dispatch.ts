import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "@/db";
import { notifications, user } from "@/db/schema";
import { getUserPreferences } from "@/lib/preferences";
import { getI18nFor } from "@/lib/i18n/translate";
import { loadOverrides, resolveChannels } from "./preferences";
import { listSubscriptions, sendPush, vapidConfig } from "./push";
import {
  NOTIFICATIONS,
  SUMMARIZE_FROM,
  type NotificationData,
  type NotificationDefinition,
  type NotificationType,
  type Rendered,
} from "./registry";

/** One notification someone wants raised. */
export interface Draft<K extends NotificationType = NotificationType> {
  type: K;
  data: NotificationData[K];
  /**
   * At most one notification per user per key, ever (within the ledger's
   * retention). Carries the "once per X" rule: `budget.over:<plan>:<cat>:<month>`.
   */
  dedupeKey: string;
}

/** Type-safe draft constructor (a plain object literal loses the type ↔ data link). */
export function draft<K extends NotificationType>(type: K, data: NotificationData[K], dedupeKey: string): Draft<K> {
  return { type, data, dedupeKey };
}

interface Fresh {
  id: string;
  draft: Draft;
}

/**
 * Raise a batch of notifications for one user:
 *  1. record each in the ledger — a key that is already there is dropped, so
 *     raising the same thing twice is harmless and evaluators can be naive;
 *  2. per type, resolve the user's channels;
 *  3. word it in their language (several of one type → one summary) and send.
 *
 * Returns how many notifications were new. Delivery failures are logged, not
 * thrown: the ledger row stays, so a failed push is not retried into a storm.
 */
export async function dispatch(userId: string, drafts: Draft[]): Promise<number> {
  const fresh: Fresh[] = [];
  for (const d of drafts) {
    const [row] = await db
      .insert(notifications)
      .values({ userId, type: d.type, dedupeKey: d.dedupeKey, data: JSON.stringify(d.data) })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    if (row) fresh.push({ id: row.id, draft: d });
  }
  if (fresh.length === 0) return 0;

  const [prefs, overrides] = await Promise.all([getUserPreferences(userId), loadOverrides(userId)]);
  const i18n = getI18nFor(prefs.locale);
  let subscriptions: Awaited<ReturnType<typeof listSubscriptions>> | null = null;
  let email: string | null | undefined;

  const byType = new Map<NotificationType, Fresh[]>();
  for (const f of fresh) byType.set(f.draft.type, [...(byType.get(f.draft.type) ?? []), f]);

  for (const [type, items] of byType) {
    const def = NOTIFICATIONS[type] as NotificationDefinition<unknown>;
    const channels = resolveChannels(type, overrides);
    const ids = items.map((i) => i.id);
    const datas = items.map((i) => i.draft.data);

    if (channels.push?.enabled && vapidConfig()) {
      try {
        subscriptions ??= await listSubscriptions(userId);
        if (subscriptions.length > 0) {
          const messages: Rendered[] =
            def.summarize && datas.length >= SUMMARIZE_FROM
              ? [def.summarize(datas, i18n)]
              : datas.map((d) => def.render(d, i18n));
          let delivered = 0;
          for (const m of messages) {
            delivered += await sendPush(userId, subscriptions, m, {
              ttlSeconds: def.ttlSeconds,
              urgency: def.urgency,
            });
          }
          if (delivered > 0) await markSent(userId, ids, "pushedAt");
        }
      } catch (err) {
        console.error(`[notifications] push failed (${type}):`, err instanceof Error ? err.name : "error");
      }
    }

    if (channels.email?.enabled && def.email) {
      try {
        if (email === undefined) email = await userEmail(userId);
        if (email) {
          for (const d of datas) await def.email(email, d, prefs.locale);
          await markSent(userId, ids, "emailedAt");
        }
      } catch (err) {
        // The provider's error can echo the address; report the type only.
        console.error(`[notifications] email failed (${type}):`, err instanceof Error ? err.name : "error");
      }
    }
  }
  return fresh.length;
}

/**
 * Raise one notification where something just happened (a sign-in, a bank
 * connected). Never throws: a notification that can't be sent must not undo or
 * block the action it reports.
 */
export async function notify<K extends NotificationType>(
  userId: string,
  type: K,
  data: NotificationData[K],
  dedupeKey: string,
): Promise<void> {
  try {
    await dispatch(userId, [draft(type, data, dedupeKey)]);
  } catch (err) {
    console.error(`[notifications] ${type} failed:`, err instanceof Error ? err.name : "error");
  }
}

/** Does the ledger hold any key starting with `prefix` for this user? `prefix` is ours, never user input. */
export async function hasLedgerKeyPrefix(userId: string, prefix: string): Promise<boolean> {
  const [row] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), like(notifications.dedupeKey, `${prefix}%`)))
    .limit(1);
  return !!row;
}

/** Record a key without sending anything — "this is known, don't tell me about it". */
export async function recordSilently<K extends NotificationType>(
  userId: string,
  type: K,
  data: NotificationData[K],
  dedupeKey: string,
): Promise<void> {
  await db
    .insert(notifications)
    .values({ userId, type, dedupeKey, data: JSON.stringify(data) })
    .onConflictDoNothing();
}

async function markSent(userId: string, ids: string[], column: "pushedAt" | "emailedAt") {
  await db
    .update(notifications)
    .set({ [column]: new Date().toISOString() })
    .where(and(eq(notifications.userId, userId), inArray(notifications.id, ids)));
}

async function userEmail(userId: string): Promise<string | null> {
  // `user` is better-auth's table and has no user_id column; its own id is the scope.
  const [row] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1);
  return row?.email ?? null;
}
