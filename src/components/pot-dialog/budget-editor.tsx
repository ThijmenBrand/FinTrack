"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Copy, CornerDownRight, Loader2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { potBudgetQuery } from "@/hooks/use-pots";
import { useI18n } from "@/lib/i18n/client";
import { CategoryChips, type CategoryInfo } from "./category-chips";
import {
  addCategory,
  addLine,
  addSubLine,
  copyFrom,
  draftAllocation,
  emptyDraft,
  formatAmount,
  lineCents,
  matchTotalToLines,
  removeCategory,
  removeLine,
  updateLine,
  usedCategoryIds,
  type DraftLine,
  type PotBudgetDraft,
} from "./draft";

export interface CopySource {
  id: string;
  name: string;
  lineCount: number;
}

interface BudgetEditorProps {
  draft: PotBudgetDraft;
  onChange: (draft: PotBudgetDraft) => void;
  categories: CategoryInfo[];
  /** Other pots with lines to copy from. */
  copySources: CopySource[];
  /** What the pot has set aside — clearing the date resets it, so say so. */
  fundedAmount?: number;
  idPrefix: string;
}

/**
 * The total, the date it's saved toward, and the lines that split it. Pure
 * draft editing: the dialog around it owns saving.
 */
export function BudgetEditor({ draft, onChange, categories, copySources, fundedAmount = 0, idPrefix }: BudgetEditorProps) {
  const { t, formatCurrency: fc, formatDate } = useI18n();
  const taken = usedCategoryIds(draft);
  const allocation = draftAllocation(draft);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-total`}>{t("pots.budget.total")}</Label>
          <MoneyInput
            id={`${idPrefix}-total`}
            value={draft.total}
            onChange={(total) => onChange({ ...draft, total })}
            placeholder="2000"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-date`}>{t("pots.budget.targetDate")}</Label>
          <div className="flex gap-1.5">
            <Input
              id={`${idPrefix}-date`}
              type="date"
              value={draft.targetDate}
              onChange={(e) => onChange({ ...draft, targetDate: e.target.value })}
              className="min-w-0 flex-1"
            />
            {draft.targetDate && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => onChange({ ...draft, targetDate: "" })}
                aria-label={t("pots.budget.clearDate")}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {draft.targetDate
          ? t("pots.budget.dateHint", { date: formatDate(draft.targetDate) })
          : fundedAmount > 0
            ? t("pots.budget.dateClearedHint", { amount: fc(fundedAmount) })
            : t("pots.budget.noDateHint")}
      </p>

      <AllocationIndicator
        allocation={allocation}
        onMatch={() => onChange(matchTotalToLines(draft))}
      />

      {draft.lines.length > 0 && (
        <ul className="space-y-2.5">
          {draft.lines.map((line) => (
            <li key={line.key} className="space-y-2.5 rounded-lg border p-3">
              <LineFields
                line={line}
                draft={draft}
                onChange={onChange}
                categories={categories}
                taken={taken}
              />
              {line.children.length > 0 && (
                <ul className="ml-1 space-y-3 border-l pl-3 sm:ml-2">
                  {line.children.map((child) => (
                    <li key={child.key} className="space-y-2">
                      <LineFields
                        line={child}
                        draft={draft}
                        onChange={onChange}
                        categories={categories}
                        taken={taken}
                        sub
                      />
                    </li>
                  ))}
                </ul>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => onChange(addSubLine(draft, line.key))}
              >
                <CornerDownRight className="h-3 w-3" />
                {t("pots.budget.addSubLine")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onChange(addLine(draft))}>
          <Plus className="h-3.5 w-3.5" />
          {t("pots.budget.addLine")}
        </Button>
        <CopyFromPot sources={copySources} onCopy={(tree) => onChange(copyFrom(draft, tree))} />
        {(draft.total || draft.lines.length > 0 || draft.targetDate) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto text-muted-foreground"
            onClick={() => onChange(emptyDraft())}
          >
            {t("pots.budget.remove")}
          </Button>
        )}
      </div>
    </div>
  );
}

function MoneyInput({
  id,
  value,
  onChange,
  placeholder,
  readOnly,
  className,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        €
      </span>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        tabIndex={readOnly ? -1 : undefined}
        aria-label={ariaLabel}
        onChange={(e) => onChange?.(e.target.value)}
        className={cn("pl-6 text-right tabular-nums", readOnly && "bg-muted/50 text-muted-foreground")}
      />
    </div>
  );
}

function LineFields({
  line,
  draft,
  onChange,
  categories,
  taken,
  sub = false,
}: {
  line: DraftLine;
  draft: PotBudgetDraft;
  onChange: (d: PotBudgetDraft) => void;
  categories: CategoryInfo[];
  taken: Set<string>;
  sub?: boolean;
}) {
  const { t } = useI18n();
  const isParent = line.children.length > 0;
  return (
    <>
      <div className="flex items-center gap-2">
        <Input
          value={line.name}
          onChange={(e) => onChange(updateLine(draft, line.key, { name: e.target.value }))}
          placeholder={sub ? t("pots.budget.subLinePlaceholder") : t("pots.budget.linePlaceholder")}
          aria-label={sub ? t("pots.budget.subLineName") : t("pots.budget.lineName")}
          maxLength={50}
          className={cn("min-w-0 flex-1", sub && "h-8 text-sm")}
        />
        <MoneyInput
          value={isParent ? formatAmount(lineCents(line) / 100) : line.amount}
          onChange={isParent ? undefined : (amount) => onChange(updateLine(draft, line.key, { amount }))}
          readOnly={isParent}
          ariaLabel={t("pots.budget.lineAmount", { line: line.name || "…" })}
          className={cn("w-28 shrink-0 sm:w-32", sub && "[&_input]:h-8 [&_input]:text-sm")}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("shrink-0 text-muted-foreground", sub && "h-8 w-8")}
          onClick={() => onChange(removeLine(draft, line.key))}
          aria-label={t("pots.budget.removeLine", { line: line.name || "…" })}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <CategoryChips
        value={line.categoryIds}
        categories={categories}
        taken={taken}
        lineName={line.name}
        onAdd={(id) => onChange(addCategory(draft, line.key, id))}
        onRemove={(id) => onChange(removeCategory(draft, line.key, id))}
      />
    </>
  );
}

function AllocationIndicator({
  allocation,
  onMatch,
}: {
  allocation: ReturnType<typeof draftAllocation>;
  onMatch: () => void;
}) {
  const { t, formatCurrency: fc } = useI18n();
  const { state, diff, planned } = allocation;
  if (state === "noLines") return null;

  const match = state === "match";
  const message =
    state === "match"
      ? t("pots.budget.matched")
      : state === "under"
        ? t("pots.budget.unallocated", { amount: fc(diff) })
        : state === "over"
          ? t("pots.budget.overTotal", { amount: fc(-diff) })
          : t("pots.budget.needsTotal", { amount: fc(planned) });

  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm",
        match
          ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
          : state === "over"
            ? "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-400"
            : "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400",
      )}
    >
      {match ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
      <span className="min-w-0 flex-1">{message}</span>
      {!match && planned > 0 && (
        <Button type="button" size="sm" variant="outline" className="h-7 bg-background px-2 text-xs" onClick={onMatch}>
          {t("pots.budget.matchTotal", { amount: fc(planned) })}
        </Button>
      )}
    </div>
  );
}

function CopyFromPot({ sources, onCopy }: { sources: CopySource[]; onCopy: (tree: Parameters<typeof copyFrom>[1]) => void }) {
  const { t, plural } = useI18n();
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  if (sources.length === 0) return null;

  const pick = async (id: string) => {
    setLoading(true);
    setFailed(false);
    try {
      onCopy(await qc.fetchQuery(potBudgetQuery(id)));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="sm" disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
            {t("pots.budget.copyFrom")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-y-auto">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {t("pots.budget.copyFromHint")}
          </DropdownMenuLabel>
          {sources.map((s) => (
            <DropdownMenuItem key={s.id} onSelect={() => pick(s.id)} className="flex justify-between gap-3">
              <span className="truncate">{s.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {plural(s.lineCount, "pots.card.lines.one", "pots.card.lines.other")}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {failed && <span className="text-xs text-red-600 dark:text-red-400">{t("pots.budget.copyFailed")}</span>}
    </>
  );
}
