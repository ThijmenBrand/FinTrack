"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CategoryPicker } from "@/components/category-picker";
import { Plus, Minus } from "lucide-react";
import type { Category } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";
import { newSplitRow, rebalanceRows, splitCents, type SplitRow } from "./split-rows";

type PickerCategory = Pick<Category, "id" | "name" | "color">;

/**
 * The split rows themselves: amounts as positive magnitudes, a category per
 * part, and the allocation hint. Purely presentational — it never talks to the
 * API, so the import review step can drive it from local state.
 */
export function SplitPartsEditor({
  totalCents,
  categories,
  accountId,
  initialRows,
  showDescriptions = true,
  pending = false,
  error,
  onSave,
  onCancel,
}: {
  /** Magnitude of the parent amount in cents — the parts must add up to it. */
  totalCents: number;
  categories: PickerCategory[];
  accountId: string;
  initialRows: SplitRow[];
  showDescriptions?: boolean;
  pending?: boolean;
  error?: string | null;
  onSave: (rows: SplitRow[]) => void;
  onCancel: () => void;
}) {
  const { t, formatCurrency } = useI18n();
  const [rows, setRows] = useState<SplitRow[]>(initialRows);

  const allocatedCents = rows.reduce((sum, r) => sum + splitCents(r.amount), 0);
  const remainderCents = totalCents - allocatedCents;
  const rowsValid = rows.every((r) => splitCents(r.amount) > 0);
  const canSave = rows.length >= 2 && remainderCents === 0 && rowsValid;

  const updateRow = (key: string, patch: Partial<SplitRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const removeRow = (key: string) =>
    setRows((prev) => (prev.length > 2 ? prev.filter((r) => r.key !== key) : prev));

  const addRow = () =>
    setRows((prev) => [...prev, newSplitRow((Math.max(0, remainderCents) / 100).toFixed(2))]);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.key} className="space-y-1 rounded-md border p-2">
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={row.amount}
                onChange={(e) =>
                  setRows((prev) => rebalanceRows(prev, row.key, e.target.value, totalCents))
                }
                className="h-8 w-24 text-sm"
              />
              <CategoryPicker
                value={row.categoryId}
                onChange={(id) => updateRow(row.key, { categoryId: id })}
                categories={categories}
                accountId={accountId}
                className="h-8 flex-1 text-sm"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground"
                disabled={rows.length <= 2}
                onClick={() => removeRow(row.key)}
                aria-label={t("tx.split.removePart")}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
            </div>
            {showDescriptions && (
              <Input
                value={row.description}
                onChange={(e) => updateRow(row.key, { description: e.target.value })}
                placeholder={t("tx.split.partDescription")}
                className="h-8 text-sm"
              />
            )}
          </div>
        ))}
      </div>

      <Button variant="outline" size="sm" onClick={addRow}>
        <Plus className="h-3.5 w-3.5" />
        {t("tx.split.addPart")}
      </Button>

      <p
        className={`text-xs ${
          remainderCents === 0
            ? "text-muted-foreground"
            : remainderCents > 0
              ? "text-amber-600 dark:text-amber-400"
              : "text-destructive"
        }`}
      >
        {remainderCents === 0
          ? t("tx.split.balanced")
          : remainderCents > 0
            ? t("tx.split.remaining", { amount: formatCurrency(remainderCents / 100) })
            : t("tx.split.over", { amount: formatCurrency(-remainderCents / 100) })}
      </p>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={pending}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" onClick={() => onSave(rows)} disabled={!canSave || pending}>
          {pending ? t("categorize.saving") : t("common.save")}
        </Button>
      </div>
    </div>
  );
}
