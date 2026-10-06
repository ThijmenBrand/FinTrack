import { getUserPreferences } from "@/lib/preferences";
import { getI18nFor } from "@/lib/i18n/translate";
import { dispatch, type Draft } from "./dispatch";
import { loadOverrides, resolveChannels } from "./preferences";
import { listSubscriptions, vapidConfig } from "./push";
import { NOTIFICATIONS, type NotificationType } from "./registry";
import { billsEvaluator } from "./evaluators/bills";
import { budgetEvaluator } from "./evaluators/budget";
import { subscriptionEvaluator } from "./evaluators/subscriptions";
import type { Evaluator } from "./evaluators/types";

/**
 * Notifications that come from looking at the data rather than from an event.
 * A new one is an evaluator here; the worker runs this after every bank sync
 * and once every morning.
 */
export const EVALUATORS: Evaluator[] = [budgetEvaluator, billsEvaluator, subscriptionEvaluator];

/**
 * Run every evaluator the user has a reachable channel for, then hand what
 * they propose to the dispatcher in one batch. Returns how many notifications
 * were new. One evaluator failing doesn't stop the others.
 */
export async function evaluateNotifications(userId: string, now = new Date()): Promise<number> {
  const [prefs, overrides, subscriptions] = await Promise.all([
    getUserPreferences(userId),
    loadOverrides(userId),
    listSubscriptions(userId),
  ]);
  const canPush = subscriptions.length > 0 && vapidConfig() !== null;
  const wants = (type: NotificationType) => {
    const channels = resolveChannels(type, overrides);
    return (
      (!!channels.push?.enabled && canPush) || (!!channels.email?.enabled && !!NOTIFICATIONS[type].email)
    );
  };
  const ctx = {
    userId,
    now,
    i18n: getI18nFor(prefs.locale),
    startDay: prefs.financialMonthStartDay,
    wants,
  };

  const drafts: Draft[] = [];
  for (const evaluator of EVALUATORS) {
    if (!evaluator.types.some(wants)) continue;
    try {
      drafts.push(...(await evaluator.run(ctx)).filter((d) => wants(d.type)));
    } catch (err) {
      // A bug of ours, not the user's data: the message is what makes it fixable.
      console.error(`[notifications] evaluator ${evaluator.types.join(",")} failed:`, err instanceof Error ? err.message : "error");
    }
  }
  return dispatch(userId, drafts);
}
