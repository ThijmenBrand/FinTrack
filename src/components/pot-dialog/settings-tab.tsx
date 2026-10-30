"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CategoryPicker } from "@/components/category-picker";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { useUpdatePot } from "@/hooks/use-pots";
import { useI18n } from "@/lib/i18n/client";
import type { Pot } from "@/types/api";
import type { CategoryInfo } from "./category-chips";

interface SettingsTabProps {
  pot: Pot;
  categories: CategoryInfo[];
  onArchive: () => void | Promise<void>;
  archiving: boolean;
  onDelete: () => void | Promise<void>;
  deleting: boolean;
}

/**
 * Name and category, then the pot's lifecycle. The total and its date live
 * with the budget they belong to; this tab never sends them, so saving a
 * rename can't touch the plan.
 */
export function SettingsTab({ pot, categories, onArchive, archiving, onDelete, deleting }: SettingsTabProps) {
  const { t } = useI18n();
  const updatePot = useUpdatePot();
  const [name, setName] = useState(pot.name);
  const [categoryId, setCategoryId] = useState<string | null>(pot.categoryId);
  const [error, setError] = useState(false);

  const trimmed = name.trim();
  const dirty = trimmed !== pot.name || categoryId !== pot.categoryId;

  const save = async () => {
    if (!trimmed || !dirty) return;
    setError(false);
    try {
      await updatePot.mutateAsync({
        id: pot.id,
        ...(trimmed !== pot.name ? { name: trimmed } : {}),
        ...(categoryId !== pot.categoryId ? { categoryId } : {}),
      });
    } catch {
      setError(true);
    }
  };

  return (
    <div className="space-y-6">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="pot-settings-name">{t("common.name")}</Label>
          <Input id="pot-settings-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
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
          <p className="text-xs text-muted-foreground">{t("pots.settings.categoryHint")}</p>
        </div>
        <div className="flex items-center justify-end gap-3">
          {error && <span className="text-xs text-red-600 dark:text-red-400">{t("pots.settings.saveFailed")}</span>}
          <Button type="submit" size="sm" disabled={!trimmed || !dirty || updatePot.isPending}>
            {updatePot.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("pots.edit.saveChanges")}
          </Button>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <Button variant="ghost" size="sm" onClick={onArchive} disabled={archiving}>
          {pot.archivedAt ? (
            <>
              <ArchiveRestore className="h-4 w-4" />
              {t("pots.detail.unarchive")}
            </>
          ) : (
            <>
              <Archive className="h-4 w-4" />
              {t("pots.detail.archive")}
            </>
          )}
        </Button>
        <ConfirmDeleteButton
          variant="text"
          label={t("pots.detail.deletePot")}
          onConfirm={onDelete}
          pending={deleting}
          message={t("pots.detail.deleteConfirm")}
        />
      </div>
    </div>
  );
}
