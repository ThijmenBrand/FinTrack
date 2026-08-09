import { INTL_LOCALE, type Locale } from ".";
import { en, type MessageKey } from "./messages/en";
import { nl } from "./messages/nl";

const MESSAGES: Record<Locale, Record<MessageKey, string>> = { en, nl };

export type { MessageKey };

export type Vars = Record<string, string | number>;

/** `{name}` placeholders are filled from `vars`; unknown ones are left alone. */
function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export interface I18n {
  locale: Locale;
  /** Translate a key, filling `{placeholders}` from `vars`. */
  t: (key: MessageKey, vars?: Vars) => string;
  /**
   * Pick between a singular and a plural key. English and Dutch share the
   * one/other split, so this is all the plural machinery either needs.
   * `{count}` is passed through automatically.
   */
  plural: (count: number, one: MessageKey, other: MessageKey, vars?: Vars) => string;
  formatCurrency: (amount: number, currency?: string, fractionDigits?: number) => string;
  /** e.g. "09 Aug 2026" / "09 aug 2026" */
  formatDate: (date: Date | string) => string;
  formatDateTime: (date: Date | string) => string;
  /** Short day + month, e.g. "9 Aug" — for compact chart and list labels. */
  formatDayMonth: (date: Date | string) => string;
  /** Abbreviated month name, e.g. "Aug" / "aug". */
  formatMonthShort: (date: Date | string) => string;
  /** Month + year, e.g. "August 2026" / "augustus 2026". */
  formatMonthYear: (date: Date | string) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  /** Ordinal for a day-of-month, e.g. "8th" / "8e". */
  ordinal: (n: number) => string;
  /** Intl/BCP-47 tag for the active locale — for one-off Intl calls. */
  intlLocale: string;
}

function englishOrdinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}

const cache = new Map<Locale, I18n>();

/** Locale-bound translator + formatters. Memoised per locale. */
export function getI18nFor(locale: Locale): I18n {
  const cached = cache.get(locale);
  if (cached) return cached;

  const dict = MESSAGES[locale] ?? en;
  const intlLocale = INTL_LOCALE[locale];
  const dateFmt = new Intl.DateTimeFormat(intlLocale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const dateTimeFmt = new Intl.DateTimeFormat(intlLocale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const dayMonthFmt = new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short" });
  const monthShortFmt = new Intl.DateTimeFormat(intlLocale, { month: "short" });
  const monthYearFmt = new Intl.DateTimeFormat(intlLocale, { month: "long", year: "numeric" });
  const eurFmt = new Intl.NumberFormat(intlLocale, { style: "currency", currency: "EUR" });

  const t: I18n["t"] = (key, vars) => interpolate(dict[key] ?? en[key] ?? key, vars);
  // A bare "YYYY-MM-DD" parses as UTC midnight, which renders as the previous
  // day west of Greenwich — pin it to local midnight instead.
  const asDate = (d: Date | string) =>
    d instanceof Date ? d : new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00` : d);

  const i18n: I18n = {
    locale,
    t,
    plural: (count, one, other, vars) =>
      t(count === 1 ? one : other, { count, ...vars }),
    formatCurrency: (amount, currency = "EUR", fractionDigits) => {
      if (currency === "EUR" && fractionDigits === undefined) return eurFmt.format(amount);
      return new Intl.NumberFormat(intlLocale, {
        style: "currency",
        currency,
        ...(fractionDigits !== undefined && {
          minimumFractionDigits: fractionDigits,
          maximumFractionDigits: fractionDigits,
        }),
      }).format(amount);
    },
    formatDate: (d) => dateFmt.format(asDate(d)),
    formatDateTime: (d) => dateTimeFmt.format(asDate(d)),
    formatDayMonth: (d) => dayMonthFmt.format(asDate(d)),
    formatMonthShort: (d) => monthShortFmt.format(asDate(d)),
    formatMonthYear: (d) => monthYearFmt.format(asDate(d)),
    formatNumber: (value, options) => new Intl.NumberFormat(intlLocale, options).format(value),
    ordinal: (n) => (locale === "nl" ? `${n}e` : englishOrdinal(n)),
    intlLocale,
  };

  cache.set(locale, i18n);
  return i18n;
}
