"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { Check, Hash, Pencil, Tags, X } from "lucide-react";
import { useDeleteTag, useRenameTag, useTags } from "@/hooks/use-tags";
import { useI18n } from "@/lib/i18n/client";
import type { Tag } from "@/types/api";

/**
 * The tag vocabulary, where it can be tidied. Tags are born out on the
 * transactions — the picker creates them from whatever was typed — so this
 * section deliberately has no "add" button: it exists to rename the typo and
 * delete the one-off, which is the only tag housekeeping there is.
 */
export function TagsSection() {
  const { t, plural } = useI18n();
  const { data: tags = [] } = useTags();
  const renameTag = useRenameTag();
  const deleteTag = useDeleteTag();
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="space-y-3 pt-2">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <Tags className="h-4 w-4 text-muted-foreground" />
          {t("tags.settingsTitle")}
        </h3>
        <p className="text-sm text-muted-foreground">{t("tags.settingsDescription")}</p>
      </div>

      {tags.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("tags.none")}</p>
      ) : (
        <div className="space-y-2">
          {tags.map((tag) => (
            <Card key={tag.id} className="flex items-center gap-2 px-4 py-2.5">
              {editingId === tag.id ? (
                <RenameTag
                  tag={tag}
                  pending={renameTag.isPending}
                  onCancel={() => setEditingId(null)}
                  onSave={async (name) => {
                    if (name && name !== tag.name) {
                      try {
                        await renameTag.mutateAsync({ id: tag.id, name });
                      } catch (err) {
                        console.error("Failed to rename tag:", err);
                        return;
                      }
                    }
                    setEditingId(null);
                  }}
                />
              ) : (
                <>
                  <Hash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-medium">{tag.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {plural(tag.transactionCount, "tags.usage.one", "tags.usage.other")}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    aria-label={t("tags.rename", { name: tag.name })}
                    onClick={() => setEditingId(tag.id)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <ConfirmDeleteButton
                    label={t("tags.remove", { name: tag.name })}
                    pending={deleteTag.isPending}
                    onConfirm={async () => {
                      await deleteTag.mutateAsync(tag.id);
                    }}
                  />
                </>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/** The row in its editing state — one field, Enter saves, Escape backs out. */
function RenameTag({
  tag,
  pending,
  onSave,
  onCancel,
}: {
  tag: Tag;
  pending: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(tag.name);

  return (
    <>
      <Hash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <Input
        autoFocus
        value={name}
        aria-label={t("tags.rename", { name: tag.name })}
        className="h-8"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave(name.trim());
          if (e.key === "Escape") onCancel();
        }}
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        disabled={pending || !name.trim()}
        aria-label={t("common.save")}
        onClick={() => onSave(name.trim())}
      >
        <Check className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        aria-label={t("common.cancel")}
        onClick={onCancel}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </>
  );
}
