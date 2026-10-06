import { evaluateNotifications } from "@/lib/notifications/evaluate";
import type { Handler } from "./types";

/**
 * Look at one user's data for things worth telling them (budgets, bills,
 * subscriptions). Queued after a sync brought in rows and once every morning;
 * the dedupe key on the job folds a burst of syncs into one run, and the
 * ledger's dedupe keys make re-running harmless.
 */
export const evaluateNotificationsHandler: Handler<"notifications.evaluate"> = async (_payload, ctx) => {
  const raised = await evaluateNotifications(ctx.userId);
  return { raised };
};
