"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Package, Trash2, Loader2, X } from "lucide-react";
import type { Category } from "@/types/api";

interface TransactionBulkBarProps {
  count: number;
  categories: Category[];
  canAddToPot: boolean;
  categorizePending: boolean;
  deletePending: boolean;
  onCategorize: (value: string) => void;
  onAddToPot: () => void;
  onDelete: () => void | Promise<void>;
  onClear: () => void;
}

export function TransactionBulkBar({
  count,
  categories,
  canAddToPot,
  categorizePending,
  deletePending,
  onCategorize,
  onAddToPot,
  onDelete,
  onClear,
}: TransactionBulkBarProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div className="flex items-center gap-2 flex-wrap rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
      <span className="text-sm font-medium">{count} selected</span>
      <Select value="" onValueChange={onCategorize} disabled={categorizePending}>
        <SelectTrigger className="h-8 w-48 text-xs">
          <span className="text-muted-foreground">
            {categorizePending ? "Applying..." : "Set category..."}
          </span>
        </SelectTrigger>
        <SelectContent>
          {categories.map((cat) => (
            <SelectItem key={cat.id} value={cat.id}>
              <span className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: cat.color || "#94a3b8" }}
                />
                {cat.name}
              </span>
            </SelectItem>
          ))}
          <SelectItem value="none">No category</SelectItem>
        </SelectContent>
      </Select>
      {canAddToPot && (
        <Button variant="outline" size="sm" className="h-8" onClick={onAddToPot}>
          <Package className="mr-1.5 h-3.5 w-3.5" />
          Add to Pot
        </Button>
      )}
      {confirmingDelete ? (
        <>
          <Button
            variant="destructive"
            size="sm"
            className="h-8"
            disabled={deletePending}
            onClick={async () => {
              await onDelete();
              setConfirmingDelete(false);
            }}
          >
            {deletePending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            )}
            Delete {count}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setConfirmingDelete(false)}
          >
            Cancel
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-destructive hover:text-destructive"
          onClick={() => setConfirmingDelete(true)}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Delete
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 ml-auto"
        onClick={() => {
          onClear();
          setConfirmingDelete(false);
        }}
      >
        <X className="mr-1 h-3.5 w-3.5" />
        Clear
      </Button>
    </div>
  );
}
