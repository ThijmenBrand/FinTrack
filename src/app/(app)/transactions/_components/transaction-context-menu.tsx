"use client";

import { Fragment, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  StickyNote,
  Package,
  Minus,
  Receipt,
  Trash2,
  Tag,
  Check,
  Filter,
  Hash,
  Plus,
  Search,
  Split,
  Wallet,
} from "lucide-react";
import { useCategorizeTransaction, useUpdateTransactionNotes } from "@/hooks/use-transactions";
import {
  useAddTransactionTag,
  useCreateTag,
  useRemoveTransactionTag,
  useTags,
} from "@/hooks/use-tags";
import { bandByPlan, usePlanCategoryIds } from "@/components/category-picker";
import { useResetOnChange } from "@/hooks/use-reset-on-change";
import { MAX_NOTE_LENGTH, MAX_USERNAME_LENGTH, sanitizeNote } from "@/lib/validation";
import type { Transaction, Category } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";

export interface ContextMenuState {
  x: number;
  y: number;
  tx: Transaction;
}

interface TransactionContextMenuProps {
  menu: ContextMenuState | null;
  categories: Category[];
  onClose: () => void;
  onAddNote: (tx: Transaction) => void;
  onAddToPot: (tx: Transaction) => void;
  onRemoveFromPot: (tx: Transaction) => void;
  onReimburse: (tx: Transaction) => void;
  onDelete: (tx: Transaction) => void;
  onFilterByCategory: (tx: Transaction) => void;
  onFilterByName: (tx: Transaction) => void;
  /** Unset while the list is already narrowed to accounts — adding one more
   *  would widen it, not filter it. */
  onFilterByAccount?: (tx: Transaction) => void;
  /** Opens the name-it dialog for a tag that doesn't exist yet. */
  onNewTag: (tx: Transaction) => void;
  /** Opens the detail dialog with the split editor active — new split or edit. */
  onSplit: (tx: Transaction) => void;
  onUnsplit: (tx: Transaction) => void;
}

/** True for a row eligible to start a fresh split: income/expense, not a
 *  split child or parent already, not in a pot, not reimbursement-linked. */
function canSplit(tx: Transaction): boolean {
  return (
    (tx.type === "income" || tx.type === "expense") &&
    !tx.parentTransactionId &&
    !tx.isSplitParent &&
    !tx.groupId &&
    tx.reimbursementCount === 0
  );
}

/** Right-click menu for transaction rows, anchored at the cursor. */
export function TransactionContextMenu({
  menu,
  categories,
  onClose,
  onAddNote,
  onAddToPot,
  onRemoveFromPot,
  onReimburse,
  onDelete,
  onFilterByCategory,
  onFilterByName,
  onFilterByAccount,
  onNewTag,
  onSplit,
  onUnsplit,
}: TransactionContextMenuProps) {
  const { t } = useI18n();
  const categorize = useCategorizeTransaction();
  const tx = menu?.tx;
  // Same order as CategoryPicker: the row account's budget plan first. A menu
  // rather than the picker itself — a right-click is for the quick pick, and
  // the row's own category control is one click away for search and create.
  const planIds = usePlanCategoryIds(tx?.accountId, { enabled: !!tx });
  const { inPlan, rest, banded } = bandByPlan(categories, planIds);

  // Tags live beside the category: the row's ACCOUNT OWNER's vocabulary, same
  // as the detail dialog's picker offers.
  const { data: availableTags = [] } = useTags(tx?.accountId, { enabled: !!tx });
  const addTag = useAddTransactionTag();
  const removeTag = useRemoveTransactionTag();
  // Several tags in one visit, so the submenu stays open on a pick — and the
  // ticks come from here, since `menu.tx` is a snapshot taken at right-click
  // time and never hears about the writes.
  const [tagIds, setTagIds] = useState<string[]>([]);
  useResetOnChange(tx?.id, () => setTagIds((tx?.tags ?? []).map((tag) => tag.id)));

  const toggleTag = (tagId: string) => {
    if (!tx) return;
    const on = tagIds.includes(tagId);
    // The tick moves first and goes back if the write doesn't land, so the
    // list never claims a tag the row hasn't got.
    setTagIds((ids) => (on ? ids.filter((id) => id !== tagId) : [...ids, tagId]));
    const undo = (err: unknown) => {
      console.error("Failed to change tag:", err);
      setTagIds((ids) => (on ? [...ids, tagId] : ids.filter((id) => id !== tagId)));
    };
    const vars = { transactionId: tx.id, tagId };
    if (on) removeTag.mutate(vars, { onError: undo });
    else addTag.mutate(vars, { onError: undo });
  };

  return (
    <DropdownMenu open={!!menu} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DropdownMenuTrigger asChild>
        <span
          className="fixed h-0 w-0"
          style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      {tx && (
        <DropdownMenuContent align="start" sideOffset={0} className="w-52">
          <DropdownMenuItem onSelect={() => onAddNote(tx)}>
            <StickyNote />
            {tx.notes ? t("tx.menu.editNote") : t("tx.menu.addNote")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onFilterByName(tx)}>
            <Search />
            {t("tx.menu.filterByName")}
          </DropdownMenuItem>
          {onFilterByAccount && (
            <DropdownMenuItem onSelect={() => onFilterByAccount(tx)}>
              <Wallet />
              {t("tx.menu.filterByAccount")}
            </DropdownMenuItem>
          )}
          {tx.categoryId && (
            <DropdownMenuItem onSelect={() => onFilterByCategory(tx)}>
              <Filter />
              {t("tx.menu.filterByCategory")}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {!tx.isSplitParent && (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Tag />
                  {t("tx.menu.changeCategory")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                  {[
                    { key: "in", label: t("categoryPicker.inBudget"), list: inPlan },
                    { key: "rest", label: t("categoryPicker.outsideBudget"), list: rest },
                  ].map(({ key, label, list }) =>
                    list.length === 0 ? null : (
                      <Fragment key={key}>
                        {banded && (
                          <>
                            {key === "rest" && <DropdownMenuSeparator />}
                            <DropdownMenuLabel>{label}</DropdownMenuLabel>
                          </>
                        )}
                        {list.map((c) => (
                          <DropdownMenuItem
                            key={c.id}
                            onSelect={() => categorize.mutate({ transactionId: tx.id, categoryId: c.id })}
                          >
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: c.color ?? undefined }}
                            />
                            <span className="truncate">{c.name}</span>
                            {tx.categoryId === c.id && <Check className="ml-auto" />}
                          </DropdownMenuItem>
                        ))}
                      </Fragment>
                    ),
                  )}
                  {tx.categoryId && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => categorize.mutate({ transactionId: tx.id, categoryId: null })}
                      >
                        {t("tx.menu.removeCategory")}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          )}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Hash />
              {t("tags.label")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
              {availableTags.map((tag) => (
                <DropdownMenuItem
                  key={tag.id}
                  // The menu would close on a pick, and tagging is rarely one
                  // tag: hold it open and let the ticks answer.
                  onSelect={(e) => {
                    e.preventDefault();
                    toggleTag(tag.id);
                  }}
                >
                  <Hash className="opacity-60" />
                  <span className="truncate">{tag.name}</span>
                  {tagIds.includes(tag.id) && <Check className="ml-auto" />}
                </DropdownMenuItem>
              ))}
              {availableTags.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => onNewTag(tx)}>
                <Plus />
                {t("tx.menu.newTag")}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {!tx.isSplitParent && (
            <>
              {!tx.groupId ? (
                <DropdownMenuItem onSelect={() => onAddToPot(tx)}>
                  <Package />
                  {t("tx.row.addToPot")}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => onRemoveFromPot(tx)}>
                  <Minus />
                  {t("tx.row.removeFromPot")}
                </DropdownMenuItem>
              )}
              {(tx.type === "income" || tx.type === "reimbursement") && (
                <DropdownMenuItem onSelect={() => onReimburse(tx)}>
                  <Receipt />
                  {tx.type === "reimbursement"
                    ? t("tx.row.linkToExpenses")
                    : t("tx.row.markReimbursement")}
                </DropdownMenuItem>
              )}
            </>
          )}
          {tx.isSplitParent ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onSplit(tx)}>
                <Split />
                {t("tx.menu.editSplit")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onUnsplit(tx)}>
                <Split />
                {t("tx.menu.unsplit")}
              </DropdownMenuItem>
            </>
          ) : (
            canSplit(tx) && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onSplit(tx)}>
                  <Split />
                  {t("tx.menu.split")}
                </DropdownMenuItem>
              </>
            )
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => onDelete(tx)}
          >
            <Trash2 />
            {t("tx.row.deleteTransaction")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}

interface TransactionNoteDialogProps {
  tx: Transaction;
  onClose: () => void;
}

/** Minimal note editor dialog, opened from the context menu. */
export function TransactionNoteDialog({ tx, onClose }: TransactionNoteDialogProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(tx.notes ?? "");
  const updateNotes = useUpdateTransactionNotes();

  const save = () => {
    const next = sanitizeNote(draft);
    if (next !== tx.notes) {
      updateNotes.mutate(
        { transactionId: tx.id, notes: next },
        { onError: (err) => console.error("Failed to save note:", err) }
      );
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate">
            {t("tx.note.title", { name: tx.name || tx.description })}
          </DialogTitle>
        </DialogHeader>
        <Textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              save();
            }
          }}
          maxLength={MAX_NOTE_LENGTH}
          rows={3}
          placeholder={t("tx.note.placeholder")}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save}>{t("common.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface TransactionTagDialogProps {
  tx: Transaction;
  onClose: () => void;
}

/**
 * Name a tag that doesn't exist yet and put it on the row in one gesture,
 * for the right-click menu — whose submenu can tick an existing tag but has
 * nowhere to type a new one.
 */
export function TransactionTagDialog({ tx, onClose }: TransactionTagDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  // A tag made on a shared row belongs to the account's OWNER, or the row
  // couldn't carry it.
  const createTag = useCreateTag(tx.accountId);
  const addTag = useAddTransactionTag();
  const trimmed = name.trim();

  const save = async () => {
    if (!trimmed || createTag.isPending) return;
    try {
      // The id is ours so the tag can go on the row without a second round
      // trip; a name that already exists comes back as the existing tag.
      const created = await createTag.mutateAsync({ id: crypto.randomUUID(), name: trimmed });
      addTag.mutate({ transactionId: tx.id, tagId: created.id });
    } catch (err) {
      console.error("Failed to create tag:", err);
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate">
            {t("tags.newTitle", { name: tx.name || tx.description })}
          </DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
          maxLength={MAX_USERNAME_LENGTH}
          placeholder={t("tags.namePlaceholder")}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={!trimmed || createTag.isPending}>
            {t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
