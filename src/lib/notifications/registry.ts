import { sendBankSecurityEmail } from "@/lib/email";
import type { Locale } from "@/lib/i18n";
import type { I18n } from "@/lib/i18n/translate";
import type { Channel, NotificationData, NotificationGroup, NotificationType } from "./types";
import { CHANNELS } from "./types";

export * from "./types";

/**
 * Every notification FinTrack can send, in one table. A type's entry says
 * which settings group it sits in, which channels it may use (and whether
 * they start on, or can't be turned off), and how to word it. The settings
 * page, the preferences API and the dispatcher all read this table — adding a
 * notification is an entry here, its strings, and whatever raises it.
 */

/** What the user sees: on the lock screen, and where a tap takes them. */
export interface Rendered {
  title: string;
  body: string;
  /** Same-origin path. */
  url: string;
  /** A newer notification with the same tag replaces the older one on the device. */
  tag: string;
}

export interface ChannelRule {
  /** On unless the user turns it off. */
  default: boolean;
  /** Always on; shown in settings but can't be switched off. */
  locked?: boolean;
}

export interface NotificationDefinition<D> {
  group: NotificationGroup;
  channels: Partial<Record<Channel, ChannelRule>>;
  render(data: D, i18n: I18n): Rendered;
  /** Several of this type in one run become one message instead of a stack. */
  summarize?(items: D[], i18n: I18n): Rendered;
  /** Required for a type that offers the email channel. */
  email?(to: string, data: D, locale: Locale): Promise<void>;
  /** How long a push service may hold the message for an offline device. */
  ttlSeconds: number;
  urgency?: "low" | "normal" | "high";
}

type Registry = { [K in NotificationType]: NotificationDefinition<NotificationData[K]> };

/** At this many of one type in a run, `summarize` takes over. */
export const SUMMARIZE_FROM = 3;

function appUrl(): string {
  return (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** "Groceries, Eating out and 2 more" */
function listNames(names: string[], i18n: I18n): string {
  if (names.length <= 2) return names.join(i18n.t("notifications.listAnd"));
  return i18n.t("notifications.listMore", {
    names: names.slice(0, 2).join(", "),
    count: names.length - 2,
  });
}

/** "today" / "tomorrow" / "on 9 Aug" for a YYYY-MM-DD date. */
export function whenLabel(date: string, i18n: I18n, today = new Date()): string {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const days = Math.round((new Date(`${date}T00:00:00`).getTime() - start) / 86_400_000);
  if (days <= 0) return i18n.t("notifications.when.today");
  if (days === 1) return i18n.t("notifications.when.tomorrow");
  return i18n.t("notifications.when.on", { date: i18n.formatDayMonth(date) });
}

const HOUR = 3600;

export const NOTIFICATIONS: Registry = {
  "budget.over": {
    group: "budgets",
    channels: { push: { default: true } },
    ttlSeconds: 12 * HOUR,
    render: (d, i18n) => ({
      title: i18n.t("notifications.budgetOver.title", { category: d.categoryName }),
      body: i18n.t("notifications.budgetOver.body", {
        spent: i18n.formatCurrency(d.spent),
        limit: i18n.formatCurrency(d.limit),
      }),
      url: "/budgets",
      tag: `budget:${d.categoryId}`,
    }),
    summarize: (items, i18n) => ({
      title: i18n.t("notifications.budgetOver.summaryTitle", { count: items.length }),
      body: listNames(items.map((d) => d.categoryName), i18n),
      url: "/budgets",
      tag: "budget:summary",
    }),
  },
  "budget.pace": {
    group: "budgets",
    channels: { push: { default: true } },
    ttlSeconds: 12 * HOUR,
    render: (d, i18n) => ({
      title: i18n.t("notifications.budgetPace.title", { category: d.categoryName }),
      body: i18n.t("notifications.budgetPace.body", {
        projected: i18n.formatCurrency(d.projected, "EUR", 0),
        limit: i18n.formatCurrency(d.limit, "EUR", 0),
        spent: i18n.formatCurrency(d.spent),
      }),
      url: "/budgets",
      tag: `budget:${d.categoryId}`,
    }),
    summarize: (items, i18n) => ({
      title: i18n.t("notifications.budgetPace.summaryTitle", { count: items.length }),
      body: listNames(items.map((d) => d.categoryName), i18n),
      url: "/budgets",
      tag: "budget:summary",
    }),
  },
  "bills.low_balance": {
    group: "bills",
    channels: { push: { default: true } },
    ttlSeconds: 24 * HOUR,
    urgency: "high",
    render: (d, i18n) => {
      const vars = {
        account: d.accountName,
        when: whenLabel(d.date, i18n),
        shortfall: i18n.formatCurrency(d.shortfall),
        balance: i18n.formatCurrency(d.balance),
      };
      const [only] = d.bills;
      return {
        title: i18n.t("notifications.lowBalance.title", vars),
        body:
          d.bills.length === 1
            ? i18n.t("notifications.lowBalance.bodyOne", {
                ...vars,
                bill: only.description,
                amount: i18n.formatCurrency(only.amount),
              })
            : i18n.t("notifications.lowBalance.bodyMany", {
                ...vars,
                date: i18n.formatDayMonth(d.date),
                count: d.bills.length,
                amount: i18n.formatCurrency(d.bills.reduce((s, b) => s + b.amount, 0)),
              }),
        url: "/recurring",
        tag: `bills:${d.accountId}`,
      };
    },
  },
  "subscription.detected": {
    group: "subscriptions",
    channels: { push: { default: true } },
    ttlSeconds: 48 * HOUR,
    urgency: "low",
    render: (d, i18n) => {
      const params = new URLSearchParams({
        add: "expense",
        description: d.merchant,
        amount: d.amount.toFixed(2),
        frequency: d.frequency,
        accountId: d.accountId,
        startDate: d.lastDate,
      });
      if (d.categoryId) params.set("categoryId", d.categoryId);
      return {
        title: i18n.t("notifications.subscription.title", { merchant: d.merchant }),
        body: i18n.t(
          d.frequency === "weekly"
            ? "notifications.subscription.bodyWeekly"
            : "notifications.subscription.bodyMonthly",
          {
            amount: i18n.formatCurrency(d.amount),
            count: d.count,
            since: i18n.formatDayMonth(d.firstDate),
          },
        ),
        url: `/recurring?${params.toString()}`,
        tag: `subscription:${d.merchant}`,
      };
    },
  },
  "bank.consent_expiring": {
    group: "bank",
    channels: { push: { default: true }, email: { default: true } },
    ttlSeconds: 48 * HOUR,
    render: (d, i18n) => ({
      title: i18n.t("notifications.consentExpiring.title", { bank: d.bank }),
      body: i18n.t("notifications.consentExpiring.body", {
        bank: d.bank,
        date: i18n.formatDate(d.date),
      }),
      url: "/settings/bank-connections",
      tag: `consent:${d.connectionId}`,
    }),
    email: (to, d, locale) =>
      sendBankSecurityEmail(
        to,
        "consentExpiring",
        `${appUrl()}/settings/bank-connections`,
        { bank: d.bank, date: d.date },
        locale,
      ),
  },
  "security.bank": {
    group: "security",
    // The mail is how someone finds out another person is in their account —
    // it stays mandatory, as it was before push existed.
    channels: { push: { default: true }, email: { default: true, locked: true } },
    ttlSeconds: 24 * HOUR,
    urgency: "high",
    render: (d, i18n) => ({
      title: i18n.t(`email.bank.${d.event}.heading`),
      body: i18n.t(`email.bank.${d.event}.body`, { bank: d.bank ?? "" }),
      url: "/settings/bank-connections",
      tag: `security:bank:${d.event}`,
    }),
    email: (to, d, locale) =>
      sendBankSecurityEmail(to, d.event, `${appUrl()}/settings/bank-connections`, { bank: d.bank }, locale),
  },
  "security.account": {
    group: "security",
    channels: { push: { default: true } },
    ttlSeconds: 24 * HOUR,
    urgency: "high",
    render: (d, i18n) => ({
      title: i18n.t(`notifications.security.${d.event}.title`),
      body: i18n.t(`notifications.security.${d.event}.body`, { device: d.device ?? "" }),
      url: "/profile",
      tag: `security:account:${d.event}`,
    }),
  },
};

export const NOTIFICATION_TYPES = Object.keys(NOTIFICATIONS) as NotificationType[];

export function isNotificationType(v: unknown): v is NotificationType {
  return typeof v === "string" && Object.hasOwn(NOTIFICATIONS, v);
}

export function isChannel(v: unknown): v is Channel {
  return typeof v === "string" && (CHANNELS as readonly string[]).includes(v);
}

export function definitionOf<K extends NotificationType>(type: K): NotificationDefinition<NotificationData[K]> {
  return NOTIFICATIONS[type] as NotificationDefinition<NotificationData[K]>;
}
