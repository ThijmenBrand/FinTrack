/**
 * How the portfolio is spread, as one horizontal bar.
 *
 * Deliberately not a donut. A household portfolio is three to eight holdings,
 * and at that count a bar beats a pie on every axis that matters: the segments
 * are in one reading order rather than around a circle, lengths compare better
 * than angles, it survives phone width without a legend floating off to one
 * side, and it sits flat in a dense layout instead of punching a circle
 * through it. The list underneath is the legend, so nothing has to be matched
 * by colour alone.
 */
import { getI18n } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/translate";

export interface AllocationSlice {
  key: string;
  label: string;
  /** Translation key for an asset class; absent for a named holding. */
  labelKey?: MessageKey;
  value: number;
}

/**
 * Fixed hues per asset class, so equities are the same colour on every screen
 * and in both themes. Not the state palette: emerald and red mean gain and
 * loss everywhere else in this app, and reusing them to mean "bonds" would
 * make a colour stop carrying one meaning.
 */
const CLASS_COLORS: Record<string, string> = {
  equity: "var(--color-sky-500)",
  bond: "var(--color-violet-500)",
  cash: "var(--color-slate-400)",
  commodity: "var(--color-amber-500)",
  real_estate: "var(--color-teal-500)",
  crypto: "var(--color-fuchsia-500)",
  other: "var(--color-stone-400)",
};

export function colorForClass(key: string): string {
  return CLASS_COLORS[key] ?? CLASS_COLORS.other;
}

export async function AllocationBar({ slices }: { slices: AllocationSlice[] }) {
  const { t, formatCurrency } = await getI18n();
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0 || slices.length === 0) return null;

  const sorted = [...slices].sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-3">
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={t("investments.allocation.label")}
      >
        {sorted.map((s) => (
          <div
            key={s.key}
            style={{
              width: `${(s.value / total) * 100}%`,
              background: colorForClass(s.key),
            }}
            // A hairline between segments, so two similar hues never read as
            // one wide band.
            className="border-r border-card last:border-r-0"
          />
        ))}
      </div>
      <ul className="space-y-1.5 text-sm">
        {sorted.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: colorForClass(s.key) }}
              />
              <span className="truncate">{s.labelKey ? t(s.labelKey) : s.label}</span>
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatCurrency(s.value)}
              <span className="ml-2 text-foreground">
                {((s.value / total) * 100).toFixed(0)}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
