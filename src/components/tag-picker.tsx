"use client";

import { Hash, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchCreatePicker } from "@/components/search-create-picker";
import {
  useAddTransactionTag,
  useCreateTag,
  useRemoveTransactionTag,
  useTags,
} from "@/hooks/use-tags";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import type { TransactionTag } from "@/types/api";

/**
 * The tags on one transaction, each removable, plus the picker that adds
 * another — type to search the vocabulary, or create one from what you typed.
 *
 * Picking is a write of its own (no Save button anywhere near a transaction),
 * so the list comes from the row and re-renders when the query cache does.
 */
export function TagPicker({
  transactionId,
  accountId,
  tags,
  readOnly = false,
}: {
  transactionId: string;
  /** Whose vocabulary to offer: the row's ACCOUNT OWNER, not the caller. */
  accountId: string;
  tags: TransactionTag[];
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  // A viewer gets no picker, so it asks for no vocabulary either.
  const { data: available = [] } = useTags(accountId, { enabled: !readOnly });
  const createTag = useCreateTag(accountId);
  const addTag = useAddTransactionTag();
  const removeTag = useRemoveTransactionTag();

  const selectedIds = tags.map((tag) => tag.id);

  // Picking a tag the row already has takes it off again — the list is the
  // row's answer, and the ticks in it are what the user is toggling.
  const toggle = (tagId: string) => {
    if (selectedIds.includes(tagId)) removeTag.mutate({ transactionId, tagId });
    else addTag.mutate({ transactionId, tagId });
  };

  if (readOnly) {
    return tags.length ? (
      <div className="flex flex-wrap items-center gap-1">
        {tags.map((tag) => (
          <TagBadge key={tag.id} name={tag.name} />
        ))}
      </div>
    ) : (
      <span className="text-sm text-muted-foreground">—</span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <TagBadge
          key={tag.id}
          name={tag.name}
          onRemove={() => removeTag.mutate({ transactionId, tagId: tag.id })}
          removeLabel={t("tags.remove", { name: tag.name })}
        />
      ))}
      <SearchCreatePicker
        items={available.map((tag) => ({ id: tag.id, name: tag.name }))}
        value={null}
        selectedIds={selectedIds}
        onSelect={toggle}
        creating={createTag.isPending}
        onCreate={async (name) => {
          // The id is ours, so the row can be tagged in the same gesture
          // instead of waiting a round trip to learn what was created. A name
          // that already exists comes back as the existing tag.
          //
          // Only the id is returned: the picker hands it straight to
          // `onSelect`, which is what actually puts it on the row. Tagging
          // here as well would send the same POST twice.
          const id = crypto.randomUUID();
          try {
            const created = await createTag.mutateAsync({ id, name });
            return created.id;
          } catch (err) {
            console.error("Failed to create tag:", err);
            return null;
          }
        }}
        labels={{
          search: "tags.search",
          empty: "tags.empty",
          create: "tags.createNamed",
        }}
        renderLeading={() => <Hash className="h-3 w-3 shrink-0 text-muted-foreground" />}
        trigger={
          <Button
            variant="outline"
            size="sm"
            aria-haspopup="listbox"
            className="h-6 gap-1 rounded-full px-2 text-xs font-normal text-muted-foreground"
          >
            <Plus className="h-3 w-3" />
            {tags.length ? t("tags.addAnother") : t("tags.add")}
          </Button>
        }
      />
    </div>
  );
}

/** One tag, as it reads everywhere: a hash and a word. */
export function TagBadge({
  name,
  onRemove,
  removeLabel,
  className,
}: {
  name: string;
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
}) {
  return (
    <Badge
      variant="secondary"
      className={cn("h-6 gap-0.5 rounded-full pl-1.5 pr-1.5 text-xs font-normal", className)}
    >
      <Hash className="h-2.5 w-2.5 shrink-0 opacity-60" aria-hidden />
      <span className="truncate">{name}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel}
          title={removeLabel}
          className="ml-0.5 rounded-sm p-0.5 hover:bg-muted-foreground/20"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </Badge>
  );
}
