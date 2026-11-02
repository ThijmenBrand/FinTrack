"use client";

import { useState } from "react";
import { Check, Loader2, Package, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { useDeletePotCategory, useRenamePotCategory } from "@/hooks/use-pots";
import { MAX_POT_CATEGORY_NAME } from "@/lib/pot-budget";
import { useI18n } from "@/lib/i18n/client";
import type { PotCategory } from "@/types/api";
import type { CategoryInfo } from "./category-chips";

/**
 * The pot's own categories, grouped under their parents, to rename or
 * delete. They're made where they're needed — a sub-line's category picker,
 * or the category picker of a transaction in the pot — so this is only for
 * tidying up.
 */
export function PotCategoriesSection({
  potId,
  potCategories,
  categories,
}: {
  potId: string;
  potCategories: PotCategory[];
  categories: CategoryInfo[];
}) {
  const { t } = useI18n();
  const byId = new Map(categories.map((c) => [c.id, c]));
  const sorted = [...potCategories].sort(
    (a, b) =>
      (byId.get(a.parentCategoryId)?.name ?? "").localeCompare(byId.get(b.parentCategoryId)?.name ?? "") ||
      a.name.localeCompare(b.name),
  );

  return (
    <section className="space-y-2 border-t pt-4" aria-labelledby="pot-categories-heading">
      <div>
        <h3 id="pot-categories-heading" className="text-sm font-medium">
          {t("pots.categories.title")}
        </h3>
        <p className="text-xs text-muted-foreground">{t("pots.categories.hint")}</p>
      </div>
      {sorted.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
          {t("pots.categories.empty")}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {sorted.map((c) => (
            <Row key={c.id} potId={potId} category={c} parent={byId.get(c.parentCategoryId)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({ potId, category, parent }: { potId: string; category: PotCategory; parent?: CategoryInfo }) {
  const { t } = useI18n();
  const rename = useRenamePotCategory();
  const remove = useDeletePotCategory();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const save = async () => {
    if (!trimmed || trimmed === category.name) {
      setEditing(false);
      setName(category.name);
      return;
    }
    setError(null);
    try {
      await rename.mutateAsync({ potId, categoryId: category.id, name: trimmed });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("pots.settings.saveFailed"));
    }
  };

  return (
    <li className="px-3 py-1.5">
      <div className="flex min-h-9 items-center gap-2 text-sm">
        <Package
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          style={parent?.color ? { color: parent.color } : undefined}
          aria-hidden
        />
        {editing ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setEditing(false);
                  setName(category.name);
                  setError(null);
                }
              }}
              maxLength={MAX_POT_CATEGORY_NAME}
              autoFocus
              aria-label={t("pots.categories.renameLabel", { name: category.name })}
              className="h-8 min-w-0 flex-1 text-sm"
            />
            <Button type="submit" size="icon" variant="ghost" className="h-8 w-8 shrink-0" disabled={rename.isPending} aria-label={t("common.save")}>
              {rename.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0"
              onClick={() => {
                setEditing(false);
                setName(category.name);
                setError(null);
              }}
              aria-label={t("common.cancel")}
            >
              <X className="h-4 w-4" />
            </Button>
          </form>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate">
              {category.name}
              {parent && <span className="text-muted-foreground"> · {parent.name}</span>}
            </span>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0 text-muted-foreground"
              onClick={() => setEditing(true)}
              aria-label={t("pots.categories.renameLabel", { name: category.name })}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <ConfirmDeleteButton
              label={t("pots.categories.deleteLabel", { name: category.name })}
              pending={remove.isPending}
              onConfirm={async () => {
                setError(null);
                try {
                  await remove.mutateAsync({ potId, categoryId: category.id });
                } catch (e) {
                  setError(e instanceof Error ? e.message : t("pots.settings.actionFailed"));
                }
              }}
            />
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="pb-1 pl-5.5 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </li>
  );
}
