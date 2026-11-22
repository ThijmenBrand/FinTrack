"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import type { TradeRecord } from "@/lib/holdings-db";

/**
 * What was entered, so it can be corrected.
 *
 * Positions are derived and therefore unfixable in themselves: a holding that
 * claims to have cost nothing is a trade with no price, and until the rows
 * behind the arithmetic are visible there is nowhere to go and put that right.
 *
 * Trades with no price are called out rather than listed quietly among the
 * rest — one of them is enough to make the account's cost basis, its return
 * and its free cash all wrong, so it is the one row on the page worth
 * interrupting for.
 */

const TYPE_LABELS: Record<TradeRecord["type"], MessageKey> = {
  buy: "investments.trade.buy",
  sell: "investments.trade.sell",
  dividend: "investments.trade.dividend",
  fee: "investments.trade.fee",
};

/** A buy or sell that never said what it cost. */
export function isUnpriced(trade: TradeRecord): boolean {
  return (trade.type === "buy" || trade.type === "sell") && trade.unitPrice <= 0;
}

export function TradesCard({
  trades,
  showAccount,
}: {
  trades: TradeRecord[];
  /** Only worth a column when more than one account is in the list. */
  showAccount: boolean;
}) {
  const { t, formatCurrency, formatDate, formatNumber } = useI18n();
  const [editing, setEditing] = useState<TradeRecord | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const router = useRouter();

  async function remove(trade: TradeRecord) {
    setDeletingId(trade.id);
    try {
      await apiFetch(`/api/accounts/${trade.accountId}/holdings/${trade.id}`, {
        method: "DELETE",
      });
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <div className="-mx-2 overflow-x-auto px-2">
        <table className="w-full min-w-[34rem] border-collapse">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="pb-2 pr-3 text-left font-normal">
                {t("investments.trades.date")}
              </th>
              <th className="pb-2 px-3 text-left font-normal">
                {t("investments.trades.what")}
              </th>
              <th className="pb-2 px-3 text-right font-normal">
                {t("investments.holdings.units")}
              </th>
              <th className="pb-2 px-3 text-right font-normal">
                {t("investments.trade.unitPriceLabel")}
              </th>
              <th className="hidden pb-2 px-3 text-right font-normal sm:table-cell">
                {t("investments.trade.feeLabel")}
              </th>
              <th className="pb-2 pl-3 text-right font-normal">
                <span className="sr-only">{t("investments.trades.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => {
              const unpriced = isUnpriced(trade);
              return (
                <tr key={trade.id} className="border-b last:border-b-0">
                  <td className="py-2.5 pr-3 text-sm tabular-nums whitespace-nowrap">
                    {formatDate(trade.date)}
                  </td>
                  <td className="py-2.5 px-3">
                    <p className="truncate text-sm font-medium">
                      {trade.instrumentName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t(TYPE_LABELS[trade.type])}
                      {showAccount ? ` · ${trade.accountName}` : ""}
                    </p>
                  </td>
                  <td className="py-2.5 px-3 text-right text-sm tabular-nums">
                    {trade.quantity > 0
                      ? formatNumber(trade.quantity, { maximumFractionDigits: 4 })
                      : "—"}
                  </td>
                  <td className="py-2.5 px-3 text-right text-sm tabular-nums">
                    {unpriced ? (
                      <button
                        type="button"
                        onClick={() => setEditing(trade)}
                        className="inline-flex items-center gap-1 text-amber-600 hover:underline dark:text-amber-400"
                      >
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("investments.trades.noPrice")}
                      </button>
                    ) : trade.type === "fee" ? (
                      "—"
                    ) : (
                      formatCurrency(trade.unitPrice)
                    )}
                  </td>
                  <td className="hidden py-2.5 px-3 text-right text-sm tabular-nums sm:table-cell">
                    {trade.fee > 0 ? formatCurrency(trade.fee) : "—"}
                  </td>
                  <td className="py-2.5 pl-3 text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("common.edit")}
                      onClick={() => setEditing(trade)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("common.delete")}
                      disabled={deletingId === trade.id}
                      onClick={() => remove(trade)}
                    >
                      {deletingId === trade.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <EditTradeDialog
        trade={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />
    </>
  );
}

/**
 * Correct one trade.
 *
 * Only the four fields a mistyped trade gets wrong: when, how many, at what
 * price, and the fee. Changing which fund it was is not a correction but a
 * different trade, and the API refuses it for the same reason.
 */
function EditTradeDialog({
  trade,
  onClose,
  onSaved,
}: {
  trade: TradeRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [draft, setDraft] = useState({ date: "", quantity: "", unitPrice: "", fee: "" });
  const [loaded, setLoaded] = useState<string | null>(null);

  // Fill from the trade the first time this one is opened, not on every
  // render: re-seeding would wipe what is being typed.
  if (trade && loaded !== trade.id) {
    setLoaded(trade.id);
    setError(null);
    setDraft({
      date: trade.date,
      quantity: String(trade.quantity),
      unitPrice: trade.unitPrice > 0 ? String(trade.unitPrice) : "",
      fee: trade.fee > 0 ? String(trade.fee) : "",
    });
  }

  if (!trade) return null;

  const needsQuantity = trade.type === "buy" || trade.type === "sell";
  const num = (v: string) => (v === "" ? 0 : parseFloat(v));
  const canSave = needsQuantity
    ? num(draft.quantity) > 0 && num(draft.unitPrice) > 0
    : true;

  async function save() {
    if (!trade) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/accounts/${trade.accountId}/holdings/${trade.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: draft.date,
          quantity: num(draft.quantity),
          unitPrice: num(draft.unitPrice),
          fee: num(draft.fee),
        }),
      });
      onSaved();
    } catch (e) {
      setError(
        e instanceof ApiError && e.code
          ? (e.code as MessageKey)
          : "investments.trade.failed",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("investments.trades.editTitle")}</DialogTitle>
          <DialogDescription>{trade.instrumentName}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="edit-date">{t("investments.trade.dateLabel")}</Label>
            <Input
              id="edit-date"
              type="date"
              value={draft.date}
              onChange={(e) => setDraft({ ...draft, date: e.target.value })}
            />
          </div>
          {needsQuantity && (
            <div className="grid gap-2">
              <Label htmlFor="edit-quantity">
                {t("investments.trade.quantityLabel")}
              </Label>
              <Input
                id="edit-quantity"
                type="number"
                step="0.0001"
                min="0"
                value={draft.quantity}
                onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
              />
            </div>
          )}
          {trade.type !== "fee" && (
            <div className="grid gap-2">
              <Label htmlFor="edit-unit-price">
                {trade.type === "dividend"
                  ? t("investments.trade.amountLabel")
                  : t("investments.trade.unitPriceLabel")}
              </Label>
              <Input
                id="edit-unit-price"
                type="number"
                step="0.0001"
                min="0"
                value={draft.unitPrice}
                onChange={(e) => setDraft({ ...draft, unitPrice: e.target.value })}
              />
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="edit-fee">{t("investments.trade.feeLabel")}</Label>
            <Input
              id="edit-fee"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={draft.fee}
              onChange={(e) => setDraft({ ...draft, fee: e.target.value })}
            />
          </div>
        </div>

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{t(error)}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={saving || !canSave}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
