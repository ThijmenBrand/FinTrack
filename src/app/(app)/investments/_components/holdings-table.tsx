/**
 * What is actually held, one row per instrument.
 *
 * A table, not cards: the whole job of this view is comparing the same five
 * numbers across a handful of holdings, and that is what columns are for. No
 * per-row sparkline — at this density it would be decoration competing with
 * the figures beside it.
 *
 * Every number is right-aligned and tabular so the digits line up down the
 * column, which is the only way a column of money is actually scannable.
 */
import { getI18n } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/translate";
import type { Holding } from "@/lib/holdings-db";
import { colorForClass } from "./allocation-bar";

export const ASSET_CLASS_LABELS: Record<string, MessageKey> = {
  equity: "investments.class.equity",
  bond: "investments.class.bond",
  cash: "investments.class.cash",
  commodity: "investments.class.commodity",
  real_estate: "investments.class.realEstate",
  crypto: "investments.class.crypto",
  other: "investments.class.other",
};

export async function HoldingsTable({ holdings }: { holdings: Holding[] }) {
  const { t, formatCurrency, formatDayMonth, formatNumber } = await getI18n();
  if (holdings.length === 0) return null;

  const open = holdings.filter((h) => h.quantity > 0);
  const closed = holdings.filter((h) => h.quantity === 0);

  const row = (h: Holding, isClosed: boolean) => {
    const gain = isClosed ? h.realized + h.dividends : h.totalReturn;
    return (
      <tr key={h.instrumentId} className="border-b last:border-b-0">
        <td className="py-2.5 pr-3">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: colorForClass(h.instrument.assetClass) }}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{h.instrument.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {/* ISIN beneath the name rather than in a column of its own:
                    it is how you identify a fund, not something you compare. */}
                {h.instrument.isin ?? h.instrument.symbol ?? ""}
                {isClosed ? ` · ${t("investments.holdings.closed")}` : ""}
              </p>
            </div>
          </div>
        </td>
        <td className="py-2.5 px-3 text-right text-sm tabular-nums">
          {isClosed ? "—" : formatNumber(h.quantity, { maximumFractionDigits: 4 })}
        </td>
        <td className="hidden py-2.5 px-3 text-right text-sm tabular-nums sm:table-cell">
          {h.averagePrice === null ? "—" : formatCurrency(h.averagePrice)}
        </td>
        <td className="hidden py-2.5 px-3 text-right text-sm tabular-nums md:table-cell">
          {h.price === null ? (
            "—"
          ) : (
            <>
              {formatCurrency(h.price)}
              {/* The price's own date, because a holding priced in March and
                  one priced today must not look equally current. */}
              <span className="block text-xs text-muted-foreground">
                {h.priceDate ? formatDayMonth(h.priceDate) : ""}
              </span>
            </>
          )}
        </td>
        <td className="py-2.5 px-3 text-right text-sm font-medium tabular-nums">
          {isClosed
            ? "—"
            : h.marketValue === null
              ? "—"
              : formatCurrency(h.marketValue)}
        </td>
        <td className="py-2.5 pl-3 text-right text-sm tabular-nums">
          {gain === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span
              className={
                gain >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }
            >
              {gain >= 0 ? "+" : ""}
              {formatCurrency(gain)}
            </span>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="-mx-2 overflow-x-auto px-2">
      <table className="w-full min-w-[32rem] border-collapse">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className="pb-2 pr-3 text-left font-normal">
              {t("investments.holdings.name")}
            </th>
            <th className="pb-2 px-3 text-right font-normal">
              {t("investments.holdings.units")}
            </th>
            <th className="hidden pb-2 px-3 text-right font-normal sm:table-cell">
              {t("investments.holdings.avgPrice")}
            </th>
            <th className="hidden pb-2 px-3 text-right font-normal md:table-cell">
              {t("investments.holdings.price")}
            </th>
            <th className="pb-2 px-3 text-right font-normal">
              {t("investments.holdings.value")}
            </th>
            <th className="pb-2 pl-3 text-right font-normal">
              {t("investments.holdings.return")}
            </th>
          </tr>
        </thead>
        <tbody>
          {open.map((h) => row(h, false))}
          {closed.map((h) => row(h, true))}
        </tbody>
      </table>
    </div>
  );
}
