"use client";

import { Pencil, Plus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, toIsoDate } from "@/lib/utils";
import { TONE } from "@/app/(app)/budgets/_components/budget-row";
import type { PotBudgetView, PotLineView, PotUnplannedGroup } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";
import type { CategoryInfo } from "./category-chips";

interface BudgetViewProps {
  budget: PotBudgetView;
  targetDate: string | null;
  categories: Map<string, CategoryInfo>;
  categoryColor: string | null;
  onEdit: () => void;
  onAddFromUnplanned: (group: PotUnplannedGroup & { categoryId: string }) => void;
}

/** The pot's budget as it stands: each line's spend against its plan, then what no line collects. */
export function BudgetView({
  budget,
  targetDate,
  categories,
  categoryColor,
  onEdit,
  onAddFromUnplanned,
}: BudgetViewProps) {
  const { t, formatCurrency: fc, formatDate } = useI18n();

  if (budget.total == null) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center">
          <Wallet className="h-8 w-8 text-muted-foreground/40" />
          <p className="font-medium">{t("pots.budget.emptyTitle")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("pots.budget.emptyBody")}</p>
          <Button className="mt-2" onClick={onEdit}>
            <Plus className="h-4 w-4" />
            {t("pots.budget.set")}
          </Button>
        </div>
        <Unplanned budget={budget} categories={categories} onAdd={onAddFromUnplanned} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t("pots.budget.totalPlanned", { amount: fc(budget.total) })}</p>
          <p className="text-xs text-muted-foreground">
            {targetDate
              ? t(targetDate > toIsoDate(new Date()) ? "pots.budget.savingBy" : "pots.budget.spendingSince", {
                  date: formatDate(targetDate),
                })
              : t("pots.budget.noDate")}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onEdit} className="shrink-0">
          <Pencil className="h-3.5 w-3.5" />
          {t("pots.budget.edit")}
        </Button>
      </div>

      {budget.lines.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <p>{t("pots.budget.noLines", { amount: fc(budget.total) })}</p>
          <Button variant="link" className="h-auto p-0" onClick={onEdit}>
            {t("pots.budget.planLines")}
          </Button>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {budget.lines.map((line) => (
            <li key={line.id}>
              <LineRow line={line} categories={categories} color={categoryColor} />
              {line.children.length > 0 && (
                <ul className="mb-2 ml-4 space-y-0 border-l pl-1 sm:ml-5">
                  {line.children.map((child) => (
                    <li key={child.id}>
                      <LineRow line={child} categories={categories} color={categoryColor} sub />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <Unplanned budget={budget} categories={categories} onAdd={onAddFromUnplanned} />
    </div>
  );
}

function LineRow({
  line,
  categories,
  color,
  sub = false,
}: {
  line: PotLineView;
  categories: Map<string, CategoryInfo>;
  color: string | null;
  sub?: boolean;
}) {
  const { t, formatCurrency: fc } = useI18n();
  const names = line.categoryIds.map((id) => categories.get(id)?.name).filter(Boolean);
  const over = line.status === "exceeded";
  return (
    <div className={cn("space-y-1.5", sub ? "px-3 py-2" : "px-3 py-2.5")}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("truncate", sub ? "text-[13px]" : "text-sm font-medium")}>{line.name}</p>
          {/* A parent without categories of its own is just its sub-lines,
              listed right under it — nothing to warn about. */}
          {(names.length > 0 || line.children.length === 0) && (
            <p className="truncate text-xs text-muted-foreground">
              {names.length > 0 ? names.join(", ") : t("pots.budget.noCategories")}
            </p>
          )}
        </div>
        <p className="shrink-0 text-right text-sm tabular-nums">
          <span className={line.status === "ok" ? undefined : TONE[line.status].text}>{fc(line.spent)}</span>
          <span className="text-muted-foreground"> / {fc(line.planned)}</span>
          <span className={cn("block text-[11px]", over ? TONE.exceeded.text : "text-muted-foreground")}>
            {over
              ? t("pots.spend.over", { amount: fc(line.spent - line.planned) })
              : t("pots.spend.left", { amount: fc(line.remaining) })}
          </span>
        </p>
      </div>
      <div className={cn("overflow-hidden rounded-full bg-muted", sub ? "h-1" : "h-1.5")}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.min(100, line.pct)}%`,
            backgroundColor: line.status === "ok" ? color || "var(--color-primary)" : TONE[line.status].bar,
          }}
        />
      </div>
    </div>
  );
}

function Unplanned({
  budget,
  categories,
  onAdd,
}: {
  budget: PotBudgetView;
  categories: Map<string, CategoryInfo>;
  onAdd: (group: PotUnplannedGroup & { categoryId: string }) => void;
}) {
  const { t, formatCurrency: fc } = useI18n();
  const { groups } = budget.unplanned;
  if (groups.length === 0) return null;
  const hasLines = budget.lines.length > 0;
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">{hasLines ? t("pots.budget.unplanned") : t("pots.budget.byCategory")}</h3>
        <span className="text-sm tabular-nums text-muted-foreground">{fc(budget.unplanned.spent)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {hasLines ? t("pots.budget.unplannedHint") : t("pots.budget.byCategoryHint")}
      </p>
      <ul className="divide-y rounded-lg border">
        {groups.map((g) => {
          const cat = g.categoryId ? categories.get(g.categoryId) : undefined;
          return (
            <li key={g.categoryId ?? "none"} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span
                className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/30"
                style={cat?.color ? { backgroundColor: cat.color } : undefined}
              />
              <span className="min-w-0 flex-1 truncate">
                {cat?.name ?? t("pots.budget.uncategorized")}
              </span>
              <span className="shrink-0 tabular-nums">
                {g.spent < 0 ? `+${fc(-g.spent)}` : fc(g.spent)}
              </span>
              {g.categoryId && cat && g.spent > 0 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={() => onAdd({ ...g, categoryId: g.categoryId! })}
                >
                  <Plus className="h-3 w-3" />
                  {t("pots.budget.addAsLine")}
                </Button>
              ) : (
                <span className="w-[5.5rem] shrink-0" aria-hidden />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
