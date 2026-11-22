"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/client";
import type { I18n, MessageKey } from "@/lib/i18n/translate";
import { isBeforeCutoff } from "@/lib/stat-reset-marks";
import type { InsightsData } from "@/types/api";
import { formatTick, niceMax } from "./chart-axis";
import { elapsedDays } from "./period";
import {
  buildCategoryRows,
  buildMetricRows,
  cumulativeByDay,
  periodDays,
  type CategoryCompareRow,
  type MetricKey,
  type MetricRow,
} from "./period-compare-math";

const UNCATEGORIZED_COLOR = "#94a3b8";

const METRIC_LABELS: Record<MetricKey, MessageKey> = {
  income: "insights.stat.income",
  expenses: "insights.stat.expenses",
  net: "insights.stat.net",
  savingsRate: "insights.stat.savingsRate",
  txCount: "insights.periodCompare.metric.transactions",
  perDay: "insights.periodCompare.metric.perDay",
};

/** Row and header share one grid so the columns line up across both. */
const GRID =
  "grid grid-cols-3 gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,8rem))] sm:gap-x-4";

const GOOD = "text-emerald-600 dark:text-emerald-400";
const BAD = "text-red-600 dark:text-red-400";

function formatMetric(i18n: I18n, value: number | null, format: MetricRow["format"]) {
  if (value === null) return "—";
  if (format === "currency") return i18n.formatCurrency(value);
  if (format === "percent") return `${value.toFixed(1)}%`;
  return i18n.formatNumber(value);
}

/** "▲ €40 (+12%)", coloured by whether that direction is the good one. */
function Delta({
  delta,
  pct,
  format,
  upIsGood,
}: {
  delta: number | null;
  pct: number | null;
  format: MetricRow["format"];
  /** Null leaves the change uncoloured — some figures have no good direction. */
  upIsGood: boolean | null;
}) {
  const i18n = useI18n();
  if (delta === null) return <span className="text-muted-foreground">—</span>;
  // Percentage points, not percent: a savings rate moving 25% → 50% is +25pp.
  const near = format === "percent" ? Math.abs(delta) < 0.05 : Math.abs(delta) < 0.5;
  if (near) {
    return <span className="text-muted-foreground">{i18n.t("insights.periodCompare.same")}</span>;
  }
  const up = delta > 0;
  const tone = upIsGood === null ? "" : up === upIsGood ? GOOD : BAD;
  // A savings rate that went 25% → 50% moved 25 percentage points; calling
  // that "+100%" would be true of the ratio and misleading about the rate.
  if (format === "percent") {
    return (
      <span className={tone}>
        {up ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}{" "}
        {i18n.t("insights.periodCompare.percentagePoints")}
      </span>
    );
  }
  return (
    <span className={tone}>
      {up ? "▲" : "▼"} {formatMetric(i18n, Math.abs(delta), format)}
      {pct !== null && Math.abs(pct) < 1000 && (
        <span className="text-[0.9em] opacity-80">
          {" "}
          ({up ? "+" : "−"}
          {Math.abs(pct).toFixed(0)}%)
        </span>
      )}
    </span>
  );
}

/** A column header: the period's name, with its dates wrapping underneath. */
function HeadCell({
  label,
  sub,
  strong = false,
}: {
  label: string;
  sub?: string;
  strong?: boolean;
}) {
  return (
    <div className="min-w-0 text-xs font-medium text-muted-foreground">
      <div className={`truncate ${strong ? "text-foreground" : ""}`} title={label}>
        {label}
      </div>
      {sub && <div className="font-normal leading-tight">{sub}</div>}
    </div>
  );
}

/* ── Cumulative-spend chart ──────────────────────────────────────────────── */

const H = 220;
const PAD_T = 12;
const PAD_B = 26;
const PAD_L = 48;
const PAD_R = 12;

function linePath(values: number[], x: (i: number) => number, y: (v: number) => number) {
  if (values.length === 0) return "";
  if (values.length === 1) {
    // One day of data is a dot, not a line — draw a hairline so it shows.
    return `M ${x(0)} ${y(values[0])} L ${x(0) + 0.01} ${y(values[0])}`;
  }
  return values.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");
}

function PaceChart({
  aSeries,
  bSeries,
  aLabel,
  bLabel,
}: {
  aSeries: number[];
  bSeries: number[];
  aLabel: string;
  bLabel: string;
}) {
  const { t, formatCurrency } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const days = Math.max(aSeries.length, bSeries.length);
  const innerW = Math.max(1, width - PAD_L - PAD_R);
  const innerH = H - PAD_T - PAD_B;
  // A running total can dip below zero — a refund landing before the spending
  // it reverses — so the axis reaches down to meet it rather than drawing the
  // line outside the chart.
  const hi = niceMax(Math.max(...aSeries, ...bSeries, 0));
  const lowest = Math.min(0, ...aSeries, ...bSeries);
  const lo = lowest < 0 ? -niceMax(-lowest) : 0;
  // Day 1 sits on the axis, the last day at the right edge.
  const x = (i: number) => PAD_L + (days > 1 ? (i / (days - 1)) * innerW : innerW / 2);
  const y = (v: number) => PAD_T + innerH - ((v - lo) / (hi - lo)) * innerH;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * (hi - lo));
  // A handful of day labels, never crowded: day 1, the last day, and a few between.
  const step = Math.max(1, Math.ceil(days / (width < 420 ? 4 : 8)));
  const dayTicks = Array.from({ length: days }, (_, i) => i).filter(
    (i) => i % step === 0 || i === days - 1,
  );

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left - PAD_L) / innerW;
    const i = Math.round(rel * (days - 1));
    setHover(i >= 0 && i < days ? i : null);
  };

  const hoverA = hover !== null ? aSeries[hover] : undefined;
  const hoverB = hover !== null ? bSeries[hover] : undefined;

  return (
    <div ref={containerRef} className="relative">
      <svg
        width={width}
        height={H}
        className="touch-pan-y select-none"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={t("insights.periodCompare.pace.title")}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={PAD_L}
              x2={width - PAD_R}
              y1={y(v)}
              y2={y(v)}
              stroke="currentColor"
              className="text-border"
              strokeWidth="1"
              strokeDasharray={Math.abs(v) < 0.5 ? "0" : "2 4"}
            />
            <text
              x={PAD_L - 8}
              y={y(v) + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[10px] tabular-nums"
            >
              {formatTick(v)}
            </text>
          </g>
        ))}
        {dayTicks.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 8}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px] tabular-nums"
          >
            {i + 1}
          </text>
        ))}
        <path
          d={linePath(bSeries, x, y)}
          fill="none"
          stroke="currentColor"
          className="text-muted-foreground"
          strokeWidth="1.75"
          strokeDasharray="5 4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={linePath(aSeries, x, y)}
          fill="none"
          stroke="currentColor"
          className="text-primary"
          strokeWidth="2.25"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {hover !== null && (
          <>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD_T}
              y2={PAD_T + innerH}
              stroke="currentColor"
              className="text-border"
              strokeWidth="1"
            />
            {hoverB !== undefined && (
              <circle cx={x(hover)} cy={y(hoverB)} r="3" className="fill-muted-foreground" />
            )}
            {hoverA !== undefined && (
              <circle cx={x(hover)} cy={y(hoverA)} r="3.5" className="fill-primary" />
            )}
          </>
        )}
      </svg>
      {hover !== null && (hoverA !== undefined || hoverB !== undefined) && (
        <div
          className="pointer-events-none absolute top-0 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{
            left: Math.min(Math.max(x(hover) - 70, 0), Math.max(0, width - 150)),
          }}
        >
          <div className="font-medium">
            {t("insights.periodCompare.pace.day", { day: hover + 1 })}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 tabular-nums">
            <span className="h-1.5 w-3 rounded-full bg-primary" />
            <span className="text-muted-foreground">{aLabel}</span>
            <span className="ml-auto font-medium">
              {hoverA === undefined ? "—" : formatCurrency(hoverA)}
            </span>
          </div>
          <div className="flex items-center gap-1.5 tabular-nums">
            <span className="h-1.5 w-3 rounded-full bg-muted-foreground" />
            <span className="text-muted-foreground">{bLabel}</span>
            <span className="ml-auto font-medium">
              {hoverB === undefined ? "—" : formatCurrency(hoverB)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Category movers ─────────────────────────────────────────────────────── */

function CategoryRow({
  row,
  scale,
  aLabel,
  bLabel,
  onSelect,
}: {
  row: CategoryCompareRow;
  /** Largest single-period total across all rows — the bars' shared ruler. */
  scale: number;
  aLabel: string;
  bLabel: string;
  onSelect: (categoryId: string | null, period: "a" | "b") => void;
}) {
  const { t, formatCurrency } = useI18n();
  const color = row.categoryId ? row.color : UNCATEGORIZED_COLOR;
  const clickable = Boolean(row.categoryId);
  const bar = (value: number, muted: boolean) => (
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{
          width: `${Math.max((value / scale) * 100, value > 0 ? 1 : 0)}%`,
          backgroundColor: color,
          opacity: muted ? 0.4 : 1,
        }}
      />
    </div>
  );
  const amount = (value: number, period: "a" | "b", label: string) => {
    const text = formatCurrency(value);
    if (!clickable) {
      return <span className="w-20 shrink-0 text-right tabular-nums">{text}</span>;
    }
    return (
      <button
        type="button"
        onClick={() => onSelect(row.categoryId, period)}
        aria-label={t("insights.periodCompare.viewTransactions", {
          category: row.name,
          period: label,
        })}
        className="w-20 shrink-0 rounded text-right tabular-nums transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {text}
      </button>
    );
  };

  return (
    <div className="rounded-md px-2 py-2 -mx-2 transition-colors hover:bg-muted/50">
      <div className="flex items-baseline gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 translate-y-px rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="min-w-0 truncate text-sm" title={row.name}>
          {row.name}
        </span>
        {row.status !== "both" && (
          <span className="shrink-0 rounded-full border px-1.5 text-[10px] font-semibold text-muted-foreground">
            {t(
              row.status === "onlyA"
                ? "insights.periodCompare.newThisPeriod"
                : "insights.periodCompare.goneThisPeriod",
            )}
          </span>
        )}
        <span className="ml-auto shrink-0 text-xs font-medium tabular-nums">
          <Delta delta={row.delta} pct={row.pct} format="currency" upIsGood={false} />
        </span>
      </div>
      <div className="mt-1.5 space-y-1 pl-[1.125rem] text-xs">
        <div className="flex items-center gap-2">
          <span className="w-24 shrink-0 truncate text-muted-foreground" title={aLabel}>
            {aLabel}
          </span>
          {bar(row.a, false)}
          {amount(row.a, "a", aLabel)}
        </div>
        <div className="flex items-center gap-2">
          <span className="w-24 shrink-0 truncate text-muted-foreground" title={bLabel}>
            {bLabel}
          </span>
          {bar(row.b, true)}
          {amount(row.b, "b", bLabel)}
        </div>
      </div>
    </div>
  );
}

/* ── The view ────────────────────────────────────────────────────────────── */

export interface ComparePeriod {
  /** Short name for the column header, e.g. "This Month". */
  label: string;
  /** Full range, shown under the header. */
  rangeLabel: string;
  from: string;
  to: string;
}

interface PeriodCompareProps {
  a: ComparePeriod;
  b: ComparePeriod;
  aData: InsightsData;
  bData: InsightsData | undefined;
  bLoading: boolean;
  /** Which accounts both sides cover — the comparison is only fair within one. */
  scopeLabel: string;
  /** Clicking an amount opens that category's transactions for that period. */
  onCategorySelect: (categoryId: string | null, period: "a" | "b") => void;
}

/**
 * Two periods of one budget, held against each other: the headline figures in
 * a column each, the spending pace day by day, and every category that moved.
 *
 * Both sides are fetched with the same account scope, so the only thing that
 * differs between the columns is time.
 */
export function PeriodCompare({
  a,
  b,
  aData,
  bData,
  bLoading,
  scopeLabel,
  onCategorySelect,
}: PeriodCompareProps) {
  const i18n = useI18n();
  const { t } = i18n;

  const sides = useMemo(() => {
    if (!bData) return null;
    return {
      a: {
        from: a.from,
        to: a.to,
        summary: aData.summary,
        elapsedDays: elapsedDays(a.from, a.to, aData.dailyTotals),
      },
      b: {
        from: b.from,
        to: b.to,
        summary: bData.summary,
        elapsedDays: elapsedDays(b.from, b.to, bData.dailyTotals),
      },
    };
  }, [a.from, a.to, b.from, b.to, aData, bData]);

  const metrics = useMemo(
    () => (sides ? buildMetricRows(sides.a, sides.b) : []),
    [sides],
  );
  const categories = useMemo(
    () =>
      bData
        ? buildCategoryRows(aData.categoryBreakdown, bData.categoryBreakdown)
        : [],
    [aData, bData],
  );
  const aSeries = useMemo(
    () => cumulativeByDay(aData.dailyTotals, a.from, a.to),
    [aData, a.from, a.to],
  );
  const bSeries = useMemo(
    () => (bData ? cumulativeByDay(bData.dailyTotals, b.from, b.to) : []),
    [bData, b.from, b.to],
  );

  if (bLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-3 py-24 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          {t("insights.periodCompare.loading")}
        </CardContent>
      </Card>
    );
  }
  // Settled with nothing to show: the request failed. Say so rather than
  // spinning for ever on a period that is never going to arrive.
  if (!bData) {
    return (
      <Card>
        <CardContent className="py-24 text-center text-sm text-muted-foreground">
          {t("insights.periodCompare.loadFailed")}
        </CardContent>
      </Card>
    );
  }

  const aDays = periodDays(a.from, a.to);
  const bDays = periodDays(b.from, b.to);
  const lengthsDiffer = aDays > 0 && bDays > 0 && aDays !== bDays;
  // A period that hasn't finished is being judged on part of its spending.
  const aRunning = sides !== null && sides.a.elapsedDays < aDays;
  // Either side can be the older one — B is whichever period was picked, not
  // necessarily the earlier — so both are checked against the cutoff.
  const resetBetween =
    isBeforeCutoff(a.from, aData.statsCutoff) ||
    isBeforeCutoff(b.from, aData.statsCutoff);

  const categoryScale = Math.max(
    1,
    ...categories.map((c) => Math.max(c.a, c.b)),
  );

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Side by side: the headline figures, one column per period. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {t("insights.periodCompare.sideBySide")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t("insights.periodCompare.scopeNote", { scope: scopeLabel })}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className={GRID}>
            <div className="hidden sm:block" />
            <HeadCell label={a.label} sub={a.rangeLabel} strong />
            <HeadCell label={b.label} sub={b.rangeLabel} />
            <HeadCell label={t("insights.periodCompare.change")} />
            {metrics.map((row) => (
              <div key={row.key} className="contents">
                <div className="col-span-3 mt-2 text-xs text-muted-foreground sm:col-span-1 sm:mt-0 sm:self-center sm:text-sm sm:text-foreground">
                  {t(METRIC_LABELS[row.key])}
                </div>
                <div className="text-sm font-semibold tabular-nums">
                  {formatMetric(i18n, row.a, row.format)}
                </div>
                <div className="text-sm tabular-nums text-muted-foreground">
                  {formatMetric(i18n, row.b, row.format)}
                </div>
                <div className="text-xs tabular-nums">
                  <Delta
                    delta={row.delta}
                    pct={row.pct}
                    format={row.format}
                    upIsGood={row.upIsGood}
                  />
                </div>
              </div>
            ))}
          </div>
          {(lengthsDiffer || aRunning || resetBetween) && (
            <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
              {lengthsDiffer && (
                <p>
                  {t("insights.periodCompare.lengthWarning", {
                    a: String(aDays),
                    b: String(bDays),
                  })}
                </p>
              )}
              {aRunning && (
                <p>
                  {t("insights.periodCompare.runningWarning", {
                    elapsed: String(sides?.a.elapsedDays ?? 0),
                    total: String(aDays),
                  })}
                </p>
              )}
              {resetBetween && aData.statsCutoff && (
                <p>
                  {t("insights.periodCompare.resetWarning", {
                    date: i18n.formatDate(aData.statsCutoff),
                  })}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pace: how the two periods' spending stacked up day by day. */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-2 space-y-0 pb-2">
          <div>
            <CardTitle className="text-base">
              {t("insights.periodCompare.pace.title")}
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("insights.periodCompare.pace.hint")}
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-4 rounded-full bg-primary" />
              <span className="truncate">{a.label}</span>
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-1.5 w-4 rounded-full bg-muted-foreground" />
              <span className="truncate">{b.label}</span>
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {aSeries.length === 0 && bSeries.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t("insights.periodCompare.pace.empty")}
            </p>
          ) : (
            <PaceChart
              aSeries={aSeries}
              bSeries={bSeries}
              aLabel={a.label}
              bLabel={b.label}
            />
          )}
        </CardContent>
      </Card>

      {/* What moved: every category either period spent in, biggest change first. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {t("insights.periodCompare.movers.title")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t("insights.periodCompare.movers.hint")}
          </p>
        </CardHeader>
        <CardContent>
          {categories.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("insights.periodCompare.movers.empty")}
            </p>
          ) : (
            <div className="space-y-0.5">
              {categories.map((row) => (
                <CategoryRow
                  key={row.categoryId ?? "none"}
                  row={row}
                  scale={categoryScale}
                  aLabel={a.label}
                  bLabel={b.label}
                  onSelect={onCategorySelect}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
