"use client";

import Link from "next/link";
import type { InsightsData } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { extractPattern } from "@/lib/csv-utils";
import { moodFor } from "../../budgets/_components/simple-hero";

/**
 * Simple mode's whole insights page: a sentence about the period, a handful of
 * sentences about what happened in it, and one bar showing where the money
 * went. The full view's five-number strip, signal cards, category table and
 * three charts all say the same things — this one says them out loud instead
 * of asking you to read them off an axis.
 */

/** Below this the change is rounding, not a story. */
const MIN_TREND = 5;
/** Within this share of the previous total, spending counts as unchanged. */
const FLAT_RATIO = 0.03;
/** A category has to move by this much before it's worth a sentence. */
const MIN_SWING = 25;
/** A merchant has to be this share of spending before it's worth naming. */
const MIN_MERCHANT_SHARE = 0.08;
/** Categories listed by name; the rest collapse into one line. */
const TOP_CATEGORIES = 4;

export interface Beat {
  key: string;
  message: MessageKey;
  /** Money value in the sentence, as `{amount}`. */
  amount?: number;
  /** Category or merchant name, as `{name}`. */
  name?: string;
  count?: number;
  pct?: number;
  /** Set when the sentence is about a category you can click through to. */
  categoryId?: string | null;
}

/**
 * The sentences worth saying about this period, most-newsworthy first. Pure so
 * the selection rules can be tested without rendering; the caller supplies the
 * translated comparison label and does the formatting.
 *
 * `previous` is dropped by the caller (All Time, or a reset in the way), which
 * takes the two comparison beats with it.
 */
export function buildBeats(
  data: InsightsData,
  totalExpenses: number,
  hasPrevious: boolean,
): Beat[] {
  const beats: Beat[] = [];
  const previous = hasPrevious ? data.previous : null;

  // 1. Up or down — the first thing anyone asks.
  if (previous) {
    const diff = data.summary.totalExpenses - previous.totalExpenses;
    const flat =
      Math.abs(diff) < MIN_TREND ||
      (previous.totalExpenses > 0 &&
        Math.abs(diff) / previous.totalExpenses < FLAT_RATIO);
    if (flat) {
      beats.push({ key: "trend", message: "insights.simple.beat.trendFlat" });
    } else {
      beats.push({
        key: "trend",
        message:
          diff > 0
            ? "insights.simple.beat.trendUp"
            : "insights.simple.beat.trendDown",
        amount: Math.abs(diff),
      });
    }
  }

  // 2. The biggest slice — skipped when there's only one, since the bar below
  //    already says it and "100% of everything" is not an insight.
  const spending = data.categoryBreakdown
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);
  const biggest = spending.length > 1 ? spending[0] : null;
  if (biggest && totalExpenses > 0) {
    beats.push({
      key: "biggest",
      message: "insights.simple.beat.biggest",
      name: biggest.categoryName,
      amount: biggest.total,
      pct: Math.round((biggest.total / totalExpenses) * 100),
      categoryId: biggest.categoryId,
    });
  }

  // 3. The category that moved most against the same period last time. A rise
  //    is the more useful warning, so it wins over an equal-sized drop.
  if (previous) {
    const moves = spending
      .filter((c) => c.categoryId !== biggest?.categoryId)
      .map((c) => ({
        category: c,
        delta: c.total - (previous.categoryTotals[c.categoryId ?? "none"] ?? 0),
      }))
      .sort((a, b) => b.delta - a.delta);
    const up = moves[0];
    const down = moves[moves.length - 1];
    const swing =
      up && up.delta >= MIN_SWING
        ? { move: up, message: "insights.simple.beat.swing" as MessageKey }
        : down && down.delta <= -MIN_SWING
          ? { move: down, message: "insights.simple.beat.swingDown" as MessageKey }
          : null;
    if (swing) {
      beats.push({
        key: "swing",
        message: swing.message,
        name: swing.move.category.categoryName,
        amount: Math.abs(swing.move.delta),
        categoryId: swing.move.category.categoryId,
      });
    }
  }

  // 4. The one place that took a real bite.
  const merchant = data.topMerchants[0];
  if (merchant && totalExpenses > 0 && merchant.total >= totalExpenses * MIN_MERCHANT_SHARE) {
    beats.push({
      key: "merchant",
      message:
        merchant.count > 1
          ? "insights.simple.beat.merchantRepeat"
          : "insights.simple.beat.merchantOnce",
      name: extractPattern(merchant.description),
      amount: merchant.total,
      count: merchant.count,
    });
  }

  return beats;
}

/** Escape for use inside a RegExp character-safe alternation. */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Renders a translated sentence with the given substrings set in the
 * foreground weight. Keeps whole sentences in the message catalogue — word
 * order is not the same in every language, so the numbers can't be split out
 * into their own fragments.
 */
function Sentence({ text, strong }: { text: string; strong: string[] }) {
  // Two-letter names ("Op", "Uit") would match ordinary words in the sentence,
  // so only longer ones are worth emphasising. Amounts are always longer.
  const parts = [...new Set(strong.filter((s) => s.length > 2))].sort(
    (a, b) => b.length - a.length,
  );
  if (parts.length === 0) return <>{text}</>;
  const pattern = new RegExp(`(${parts.map(escapeRe).join("|")})`, "g");
  return (
    <>
      {text.split(pattern).map((part, i) =>
        parts.includes(part) ? (
          <strong key={i} className="font-semibold text-foreground">
            {part}
          </strong>
        ) : (
          part
        ),
      )}
    </>
  );
}

interface SimpleStoryProps {
  data: InsightsData;
  totalExpenses: number;
  /** Translated name of the comparison period, e.g. "last month". */
  previousLabel: string | null;
  onCategoryClick: (categoryId: string | null) => void;
}

export function SimpleStory({
  data,
  totalExpenses,
  previousLabel,
  onCategoryClick,
}: SimpleStoryProps) {
  const { t, plural, formatCurrency } = useI18n();
  const { totalIncome: income, totalExpenses: expenses, net, txCount } = data.summary;
  const mood = income > 0 ? moodFor(expenses / income) : null;

  if (txCount === 0) {
    return (
      <div className="rounded-2xl bg-muted/40 px-6 py-14 text-center">
        <p className="text-lg font-medium">{t("insights.simple.empty")}</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {t("insights.simple.emptyHint")}
        </p>
      </div>
    );
  }

  const spentText = formatCurrency(expenses);
  const netText = formatCurrency(Math.abs(net));
  const incomeText = formatCurrency(income);
  const keptPct = income > 0 ? Math.round((net / income) * 100) : 0;

  const headline =
    income <= 0
      ? { text: t("insights.simple.headline.noIncome", { spent: spentText }), strong: [spentText] }
      : net >= 0
        ? {
            text: t("insights.simple.headline.kept", { spent: spentText, net: netText }),
            strong: [spentText, netText],
          }
        : {
            text: t("insights.simple.headline.over", { spent: spentText, over: netText }),
            strong: [spentText, netText],
          };

  const sub =
    income <= 0
      ? t("insights.simple.sub.noIncome", { count: txCount })
      : net >= 0
        ? t("insights.simple.sub.withIncome", {
            income: incomeText,
            count: txCount,
            pct: keptPct,
          })
        : t("insights.simple.sub.overspent", { income: incomeText, count: txCount });

  const beats = buildBeats(data, totalExpenses, previousLabel !== null && !!data.previous);

  const spending = data.categoryBreakdown
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);
  const top = spending.slice(0, TOP_CATEGORIES);
  const rest = spending.slice(TOP_CATEGORIES);
  const restTotal = rest.reduce((s, c) => s + c.total, 0);
  const share = (value: number) =>
    totalExpenses > 0 ? (value / totalExpenses) * 100 : 0;

  return (
    // Capped at a reading measure by the page's simple-mode column — the
    // sentences are the content here, not a dashboard grid.
    <div className="space-y-10">
      {/* The verdict: how the period went, in one sentence and one bar. */}
      <section className="rounded-2xl bg-muted/40 p-5 sm:p-6">
        <div className="flex items-start gap-4 sm:gap-5">
          <span className="text-4xl leading-none sm:text-5xl" aria-hidden="true">
            {mood?.emoji ?? "💸"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-pretty text-xl leading-snug font-medium sm:text-2xl">
              <Sentence text={headline.text} strong={headline.strong} />
            </p>
            {income > 0 && (
              <div className="animate-bar-wipe mt-4 h-3 overflow-hidden rounded-full bg-background">
                <div
                  className={`h-full rounded-full bg-linear-to-r ${mood?.bar ?? ""}`}
                  style={{
                    width: `${Math.min(100, Math.max(2, (expenses / income) * 100))}%`,
                  }}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={Math.round(income)}
                  aria-valuenow={Math.round(expenses)}
                  aria-label={sub}
                />
              </div>
            )}
            <p className="mt-3 text-sm text-muted-foreground">{sub}</p>
          </div>
        </div>
      </section>

      {/* What happened, one sentence at a time. */}
      {beats.length > 0 && (
        <ul className="space-y-3.5">
          {beats.map((beat, i) => {
            const amountText =
              beat.amount === undefined ? "" : formatCurrency(beat.amount);
            const text = t(beat.message, {
              amount: amountText,
              name: beat.name ?? "",
              count: beat.count ?? 0,
              pct: beat.pct ?? 0,
              prev: previousLabel ?? "",
            });
            const body = (
              <Sentence text={text} strong={[amountText, beat.name ?? ""]} />
            );
            return (
              <li
                key={beat.key}
                className="animate-in fade-in slide-in-from-bottom-1 text-[15px] leading-relaxed text-muted-foreground duration-500 [animation-fill-mode:backwards] motion-reduce:animate-none"
                style={{ animationDelay: `${i * 90}ms` }}
              >
                {beat.categoryId !== undefined ? (
                  <button
                    type="button"
                    onClick={() => onCategoryClick(beat.categoryId ?? null)}
                    className="rounded-sm text-left underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {body}
                  </button>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Where it went: one bar, then the names behind it. */}
      {top.length > 0 && (
        <section>
          <h2 className="text-base font-semibold">
            {t("insights.simple.whereTitle")}
          </h2>
          <div
            className="animate-bar-wipe mt-3 flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted"
            aria-hidden="true"
          >
            {[...top, ...(restTotal > 0 ? [{ categoryId: "rest", categoryColor: "", total: restTotal }] : [])].map(
              (c) => (
                <div
                  key={c.categoryId ?? "none"}
                  className="h-full first:rounded-l-full last:rounded-r-full"
                  style={{
                    width: `${share(c.total)}%`,
                    backgroundColor: c.categoryColor || undefined,
                  }}
                />
              ),
            )}
          </div>
          <ul className="mt-4 space-y-0.5">
            {top.map((c) => (
              <li key={c.categoryId ?? "none"}>
                <button
                  type="button"
                  onClick={() => onCategoryClick(c.categoryId)}
                  className="flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span
                    className="size-2.5 shrink-0 translate-y-px rounded-full"
                    style={{ backgroundColor: c.categoryColor }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {c.categoryName}
                  </span>
                  <span className="text-sm font-medium tabular-nums">
                    {formatCurrency(c.total)}
                  </span>
                </button>
              </li>
            ))}
            {rest.length > 0 && (
              <li className="flex items-baseline gap-3 px-2 py-1.5 text-sm text-muted-foreground">
                <span className="size-2.5 shrink-0 rounded-full bg-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">
                  {plural(
                    rest.length,
                    "insights.simple.whereRest.one",
                    "insights.simple.whereRest.other",
                  )}
                </span>
                <span className="tabular-nums">{formatCurrency(restTotal)}</span>
              </li>
            )}
          </ul>
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        {t("insights.simple.fullViewPrefix")}{" "}
        <Link href="/settings/general" className="text-primary hover:underline">
          {t("insights.simple.fullViewLink")}
        </Link>{" "}
        {t("insights.simple.fullViewSuffix")}
      </p>
    </div>
  );
}
