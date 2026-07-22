"use client";

import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { Textarea } from "@/components/ui/textarea";
import {
  StickyNote,
  Package,
  Minus,
  Receipt,
  Trash2,
  Tag,
  Check,
} from "lucide-react";
import { useCategorizeTransaction, useUpdateTransactionNotes } from "@/hooks/use-transactions";
import { MAX_NOTE_LENGTH, sanitizeNote } from "@/lib/validation";
import type { Transaction, Category } from "@/types/api";

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
}: TransactionContextMenuProps) {
  const categorize = useCategorizeTransaction();
  const tx = menu?.tx;

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
            {tx.notes ? "Edit note" : "Add note"}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Tag />
              Change category
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
              {categories.map((c) => (
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
              {tx.categoryId && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => categorize.mutate({ transactionId: tx.id, categoryId: null })}
                  >
                    Remove category
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {!tx.groupId ? (
            <DropdownMenuItem onSelect={() => onAddToPot(tx)}>
              <Package />
              Add to pot
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => onRemoveFromPot(tx)}>
              <Minus />
              Remove from pot
            </DropdownMenuItem>
          )}
          {(tx.type === "income" || tx.type === "reimbursement") && (
            <DropdownMenuItem onSelect={() => onReimburse(tx)}>
              <Receipt />
              {tx.type === "reimbursement" ? "Link to expenses" : "Mark as reimbursement"}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => onDelete(tx)}
          >
            <Trash2 />
            Delete transaction
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
            Note — {tx.name || tx.description}
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
          placeholder="Add a note…"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
