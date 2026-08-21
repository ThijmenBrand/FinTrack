/**
 * The starter categories every new user gets, seeded in their own language.
 *
 * Names are stored rows, not translations resolved at render time — a user can
 * rename them. So code that has to find one back (the internal-transfer bucket,
 * the income buckets the budget planner hides) matches against
 * `defaultCategoryNames(...)`: every locale's spelling of that category.
 */
import { LOCALES, DEFAULT_LOCALE, type Locale } from "@/lib/i18n";
import { getI18nFor, type MessageKey } from "@/lib/i18n/translate";
import type { CategoryKind } from "@/types/api";

export const DEFAULT_CATEGORIES: {
  key: MessageKey;
  icon: string;
  color: string;
  /** Omitted = "expense", the column default and what most buckets are. */
  kind?: CategoryKind;
}[] = [
  { key: "categories.default.groceries", icon: "ShoppingCart", color: "#22c55e" },
  { key: "categories.default.diningOut", icon: "UtensilsCrossed", color: "#f97316" },
  { key: "categories.default.coffee", icon: "Coffee", color: "#92400e" },
  { key: "categories.default.transport", icon: "Car", color: "#3b82f6" },
  { key: "categories.default.housing", icon: "Home", color: "#8b5cf6" },
  { key: "categories.default.utilities", icon: "Zap", color: "#eab308" },
  { key: "categories.default.entertainment", icon: "Tv", color: "#ec4899" },
  { key: "categories.default.shopping", icon: "ShoppingBag", color: "#14b8a6" },
  { key: "categories.default.health", icon: "Heart", color: "#ef4444" },
  { key: "categories.default.subscriptions", icon: "CreditCard", color: "#6366f1" },
  { key: "categories.default.salary", icon: "Banknote", color: "#10b981", kind: "income" },
  {
    key: "categories.default.internalTransfer",
    icon: "ArrowLeftRight",
    color: "#94a3b8",
    kind: "transfer",
  },
  { key: "categories.default.other", icon: "MoreHorizontal", color: "#71717a" },
];

// TRANSFER_CATEGORY / SALARY_CATEGORY used to name the buckets that every
// transfer and income lookup matched by name. Both questions are now asked of
// `categories.kind` instead — see findTransferCategory and isBudgetable — so
// the keys have no callers left.

export function defaultCategoryName(key: MessageKey, locale: Locale = DEFAULT_LOCALE): string {
  return getI18nFor(locale).t(key);
}

/**
 * Every locale's name for the given default categories — accounts seeded in
 * different languages hold different strings for the same bucket.
 */
export function defaultCategoryNames(...keys: MessageKey[]): string[] {
  return keys.flatMap((key) => LOCALES.map((locale) => getI18nFor(locale).t(key)));
}

/**
 * Whether a category can carry a budget allocation. Only expense categories
 * can: income is planned by its recurring plans, and a transfer is money
 * moving between your own accounts, which is spending on no side at all.
 *
 * Replaces the old NON_BUDGETABLE_CATEGORY_NAMES name list — the same question,
 * asked of a stored column instead of a category's current spelling.
 */
export function isBudgetable(kind: CategoryKind): boolean {
  return kind === "expense";
}
