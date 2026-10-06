import type { BankSecurityEvent } from "@/lib/email";

/**
 * The notification vocabulary — channels, groups, and what each type carries.
 * Free of server code so the settings page can import it; the registry
 * (./registry) adds the wording and delivery on top.
 */

export const CHANNELS = ["push", "email"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Settings-page sections, in display order. */
export const GROUPS = ["budgets", "bills", "subscriptions", "bank", "security"] as const;
export type NotificationGroup = (typeof GROUPS)[number];

export type AccountSecurityEvent =
  | "newDevice"
  | "passwordChanged"
  | "twoFactorEnabled"
  | "twoFactorDisabled"
  | "passkeyAdded"
  | "passkeyRemoved";

/** What each type carries. Stored as JSON on the ledger row; ids, names and amounts only. */
export interface NotificationData {
  "budget.over": BudgetLineData;
  "budget.pace": BudgetLineData & { projected: number };
  "bills.low_balance": {
    accountId: string;
    accountName: string;
    /** The balance the walk started from. */
    balance: number;
    /** How far below zero the account is expected to go. */
    shortfall: number;
    /** YYYY-MM-DD of the bill that first takes it below zero. */
    date: string;
    bills: { description: string; amount: number; date: string }[];
  };
  "subscription.detected": {
    merchant: string;
    amount: number;
    frequency: "weekly" | "monthly";
    accountId: string;
    categoryId: string | null;
    /** Charges seen so far. */
    count: number;
    firstDate: string;
    lastDate: string;
  };
  "bank.consent_expiring": { connectionId: string; bank: string; date: string };
  "security.bank": { event: Exclude<BankSecurityEvent, "consentExpiring">; bank?: string };
  "security.account": { event: AccountSecurityEvent; device?: string };
}

export interface BudgetLineData {
  planId: string | null;
  categoryId: string;
  categoryName: string;
  spent: number;
  limit: number;
  /** First day of the financial month, YYYY-MM-DD. */
  monthStart: string;
}

export type NotificationType = keyof NotificationData;
