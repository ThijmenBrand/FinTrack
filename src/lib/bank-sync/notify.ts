import type { BankSecurityEvent } from "@/lib/email";
import { notify } from "@/lib/notifications/dispatch";

/**
 * Tell the user about a sensitive bank-sync action: always by email (it can't
 * be turned off), and by push on the devices they turned that on for. Never
 * throws: a notification that can't be sent must not undo or block the action
 * it reports.
 *
 * The consent-expiry warning has its own notification type (it is a reminder,
 * not a security event) and is raised by the worker's scheduler.
 */
export async function notifyBankEvent(
  userId: string,
  event: Exclude<BankSecurityEvent, "consentExpiring">,
  vars: { bank?: string } = {},
): Promise<void> {
  // Every occurrence is news, so every one gets its own key.
  await notify(userId, "security.bank", { event, bank: vars.bank }, `security.bank:${event}:${crypto.randomUUID()}`);
}
