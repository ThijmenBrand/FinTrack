"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CategoryPicker } from "@/components/category-picker";
import { useCreatePot, usePots } from "@/hooks/use-pots";
import { useResetOnChange } from "@/hooks/use-reset-on-change";
import { useI18n } from "@/lib/i18n/client";
import type { Category } from "@/types/api";
import { BudgetEditor } from "./budget-editor";
import { emptyDraft, toPayload, validateDraft, type PotBudgetDraft } from "./draft";

interface CreatePotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  /** The new pot's id, e.g. to open it straight away. */
  onCreated?: (id: string) => void;
}

/**
 * A new pot: name and category, and — optionally — its budget, saved in the
 * same request so a pot never exists without the plan it was made with. One
 * scrolling form rather than tabs: there's nothing to look at yet.
 */
export function CreatePotDialog({ open, onOpenChange, categories, onCreated }: CreatePotDialogProps) {
  const { t } = useI18n();
  const createPot = useCreatePot();
  const { data: pots = [] } = usePots();
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PotBudgetDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);

  useResetOnChange(open, () => {
    if (!open) return;
    setName("");
    setCategoryId(null);
    setDraft(emptyDraft());
    setError(null);
  });

  const categoryInfo = useMemo(
    () => categories.map((c) => ({ id: c.id, name: c.name, color: c.color, icon: c.icon })),
    [categories],
  );
  const copySources = useMemo(
    () => pots.filter((p) => p.lineCount > 0).map((p) => ({ id: p.id, name: p.name, lineCount: p.lineCount })),
    [pots],
  );

  const validation = validateDraft(draft);
  const canCreate = !!name.trim() && validation.ok && !createPot.isPending;

  const create = async () => {
    if (!canCreate) return;
    setError(null);
    const budget = toPayload(draft);
    try {
      const { id } = await createPot.mutateAsync({
        name: name.trim(),
        categoryId,
        targetAmount: budget.total,
        targetDate: budget.targetDate,
        lines: budget.lines,
      });
      onOpenChange(false);
      onCreated?.(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("pots.settings.saveFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-2xl">
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain pb-4 sm:px-6 sm:pt-6">
            <DialogHeader className="pr-8 text-left">
              <DialogTitle>{t("pots.create.title")}</DialogTitle>
              <DialogDescription>{t("pots.create.description")}</DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-pot-name">{t("common.name")}</Label>
                <Input
                  id="new-pot-name"
                  placeholder={t("pots.form.namePlaceholder")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("common.category")}</Label>
                <CategoryPicker
                  categories={categories}
                  budgetCategoryIds={null}
                  value={categoryId}
                  onChange={(id) => setCategoryId(id)}
                  onClear={() => setCategoryId(null)}
                  emptyLabel={t("pots.form.categoryPlaceholder")}
                />
              </div>
            </div>

            <section className="space-y-3 border-t pt-4">
              <div>
                <h3 className="text-sm font-semibold">{t("pots.create.budgetTitle")}</h3>
                <p className="text-xs text-muted-foreground">{t("pots.create.budgetHint")}</p>
              </div>
              <BudgetEditor
                draft={draft}
                onChange={setDraft}
                categories={categoryInfo}
                copySources={copySources}
                idPrefix="new-pot"
              />
            </section>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-background pt-3 sm:px-6 sm:pb-4">
            <p
              className={
                error
                  ? "mr-auto min-w-0 text-xs text-red-600 dark:text-red-400"
                  : "mr-auto min-w-0 text-xs text-muted-foreground"
              }
              role={error ? "alert" : undefined}
            >
              {error ?? (!validation.ok ? t(validation.error) : null)}
            </p>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" onClick={create} disabled={!canCreate}>
              {createPot.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("pots.create.submit")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
