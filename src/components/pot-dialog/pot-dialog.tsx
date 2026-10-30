"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AllocateToPotDialog } from "@/components/allocate-to-pot-dialog";
import { PotDetailSkeleton } from "@/components/pot-detail-skeleton";
import { useCategories } from "@/hooks/use-categories";
import { useDeletePot, usePotDetails, usePots, useSavePotBudget, useUpdatePot } from "@/hooks/use-pots";
import { potPhase } from "@/lib/pot-budget";
import { toIsoDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import type { PotBudgetTree, PotBudgetView, PotUnplannedGroup } from "@/types/api";
import { PotHero } from "./pot-hero";
import { BudgetView } from "./budget-view";
import { BudgetEditor } from "./budget-editor";
import { TransactionsTab } from "./transactions-tab";
import { SettingsTab } from "./settings-tab";
import {
  addFromUnplanned,
  draftChanged,
  draftFromTree,
  toPayload,
  validateDraft,
  type PotBudgetDraft,
} from "./draft";

export type PotTab = "budget" | "transactions" | "settings";

interface PotDialogProps {
  /** The pot to show; null closes the dialog. */
  potId: string | null;
  onOpenChange: (open: boolean) => void;
  initialTab?: PotTab;
  /** After anything is saved — e.g. a server-rendered card refreshing itself. */
  onSaved?: () => void;
}

/**
 * Everything about one pot in one place: what it's at (hero + graph), and tabs
 * for its budget, its transactions and its settings. A phone gets it as a
 * full-height bottom sheet.
 */
export function PotDialog({ potId, onOpenChange, initialTab = "budget", onSaved }: PotDialogProps) {
  // Asked before closing: true keeps the dialog open (unsaved budget edits).
  const holdOpenRef = useRef<() => boolean>(() => false);

  return (
    <Dialog
      open={!!potId}
      onOpenChange={(open) => {
        if (!open && holdOpenRef.current()) return;
        onOpenChange(open);
      }}
    >
      <DialogContent className="h-[90dvh] gap-0 p-0 sm:h-[85vh] sm:max-h-[56rem] sm:max-w-2xl">
        {potId && (
          <PotDialogBody
            key={potId}
            potId={potId}
            initialTab={initialTab}
            holdOpenRef={holdOpenRef}
            close={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The view's lines as an editable tree: what the editor starts from. */
function viewToTree(budget: PotBudgetView): PotBudgetTree {
  return {
    total: budget.total,
    lines: budget.lines.map((l) => ({
      name: l.name,
      amount: l.planned,
      categoryIds: l.categoryIds,
      children: l.children.map((c) => ({ name: c.name, amount: c.planned, categoryIds: c.categoryIds, children: [] })),
    })),
  };
}

function PotDialogBody({
  potId,
  initialTab,
  holdOpenRef,
  close,
  onSaved,
}: {
  potId: string;
  initialTab: PotTab;
  holdOpenRef: RefObject<() => boolean>;
  close: () => void;
  onSaved?: () => void;
}) {
  const { t } = useI18n();
  const { data, isLoading } = usePotDetails(potId);
  const { data: pots = [] } = usePots();
  const { data: categories = [] } = useCategories();
  const deletePot = useDeletePot();
  const updatePot = useUpdatePot();
  const saveBudget = useSavePotBudget();

  const [tab, setTab] = useState<PotTab>(initialTab);
  // Non-null while the budget is being edited; `baseline` is what it started as.
  const [draft, setDraft] = useState<PotBudgetDraft | null>(null);
  const [baseline, setBaseline] = useState<PotBudgetDraft | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [showAllocate, setShowAllocate] = useState(false);

  const todayIso = toIsoDate(new Date());
  const dirty = !!draft && !!baseline && draftChanged(draft, baseline);
  const validation = draft ? validateDraft(draft) : null;

  useEffect(() => {
    holdOpenRef.current = () => {
      if (!dirty) return false;
      setTab("budget");
      setConfirmDiscard(true);
      return true;
    };
    return () => {
      holdOpenRef.current = () => false;
    };
  }, [dirty, holdOpenRef]);

  const categoryInfo = useMemo(
    () => categories.map((c) => ({ id: c.id, name: c.name, color: c.color, icon: c.icon })),
    [categories],
  );
  const categoryMap = useMemo(() => new Map(categoryInfo.map((c) => [c.id, c])), [categoryInfo]);
  const copySources = useMemo(
    () => pots.filter((p) => p.id !== potId && p.lineCount > 0).map((p) => ({ id: p.id, name: p.name, lineCount: p.lineCount })),
    [pots, potId],
  );

  if (isLoading || !data) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto sm:p-0">
        <PotDetailSkeleton />
      </div>
    );
  }

  const { pot } = data;
  const phase = potPhase(pot, todayIso);

  const seedDraft = () => draftFromTree(viewToTree(data.budget), pot.targetDate);
  const startEditing = (apply?: (d: PotBudgetDraft) => PotBudgetDraft) => {
    const base = seedDraft();
    setBaseline(base);
    setDraft(apply ? apply(draft ?? base) : draft ?? base);
    setSaveError(null);
    setTab("budget");
  };
  const stopEditing = () => {
    setDraft(null);
    setBaseline(null);
    setSaveError(null);
    setConfirmDiscard(false);
  };

  const save = async () => {
    if (!draft || !validation?.ok) return;
    setSaveError(null);
    try {
      await saveBudget.mutateAsync({ id: pot.id, ...toPayload(draft) });
      stopEditing();
      onSaved?.();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t("pots.settings.saveFailed"));
    }
  };

  const addUnplanned = (group: PotUnplannedGroup & { categoryId: string }) => {
    const name = categoryMap.get(group.categoryId)?.name ?? "";
    startEditing((d) => addFromUnplanned(d, { id: group.categoryId, name }, group.spent));
  };

  const handleDelete = async () => {
    await deletePot.mutateAsync(pot.id);
    onSaved?.();
    close();
  };
  const handleArchive = async () => {
    await updatePot.mutateAsync({ id: pot.id, archived: !pot.archivedAt });
    onSaved?.();
    close();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="space-y-4 sm:px-6 sm:pt-6">
          <PotHero data={data} phase={phase} todayIso={todayIso} onAllocate={() => setShowAllocate(true)} />
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as PotTab)}>
          <div className="sticky top-0 z-10 bg-background pb-2 pt-4 sm:px-6">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="budget">{t("pots.dialog.tabBudget")}</TabsTrigger>
              <TabsTrigger value="transactions">
                {t("pots.dialog.tabTransactions")}
                <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{data.transactions.length}</span>
              </TabsTrigger>
              <TabsTrigger value="settings">{t("pots.dialog.tabSettings")}</TabsTrigger>
            </TabsList>
          </div>
          <div className="pb-6 pt-2 sm:px-6">
            <TabsContent value="budget" className="mt-0">
              {draft ? (
                <BudgetEditor
                  draft={draft}
                  onChange={(d) => {
                    setDraft(d);
                    setConfirmDiscard(false);
                  }}
                  categories={categoryInfo}
                  copySources={copySources}
                  fundedAmount={pot.targetDate ? pot.fundedAmount : 0}
                  idPrefix="pot-budget"
                />
              ) : (
                <BudgetView
                  budget={data.budget}
                  targetDate={pot.targetDate}
                  categories={categoryMap}
                  categoryColor={pot.categoryColor}
                  onEdit={() => startEditing()}
                  onAddFromUnplanned={addUnplanned}
                />
              )}
            </TabsContent>
            <TabsContent value="transactions" className="mt-0">
              <TransactionsTab data={data} />
            </TabsContent>
            <TabsContent value="settings" className="mt-0">
              <SettingsTab
                pot={pot}
                categories={categoryInfo}
                onArchive={handleArchive}
                archiving={updatePot.isPending}
                onDelete={handleDelete}
                deleting={deletePot.isPending}
              />
            </TabsContent>
          </div>
        </Tabs>
      </div>

      {draft && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-background pt-3 sm:px-6 sm:pb-4">
          {confirmDiscard ? (
            <>
              <p className="mr-auto text-sm">{t("pots.dialog.discardConfirm")}</p>
              <Button variant="outline" size="sm" onClick={() => setConfirmDiscard(false)}>
                {t("pots.dialog.keepEditing")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  stopEditing();
                  close();
                }}
              >
                {t("pots.dialog.discard")}
              </Button>
            </>
          ) : (
            <>
              <p
                className={
                  saveError
                    ? "mr-auto min-w-0 text-xs text-red-600 dark:text-red-400"
                    : "mr-auto min-w-0 text-xs text-muted-foreground"
                }
                role={saveError ? "alert" : undefined}
              >
                {saveError ?? (dirty && validation && !validation.ok ? t(validation.error) : null)}
              </p>
              <Button variant="outline" size="sm" onClick={stopEditing}>
                {t("common.cancel")}
              </Button>
              <Button size="sm" onClick={save} disabled={!dirty || !validation?.ok || saveBudget.isPending}>
                {saveBudget.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("pots.budget.save")}
              </Button>
            </>
          )}
        </div>
      )}

      {data.spike && pot.targetAmount != null && (
        <AllocateToPotDialog
          open={showAllocate}
          onOpenChange={setShowAllocate}
          potId={pot.id}
          potName={pot.name}
          targetAmount={pot.targetAmount}
          fundedAmount={pot.fundedAmount}
          suggestedAmount={data.spike.suggestedAllocation}
          onAllocated={onSaved}
        />
      )}
    </div>
  );
}
