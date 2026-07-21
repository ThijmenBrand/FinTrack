"use client";

import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface PickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  search: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder: string;
  /** Omit for pickers with synchronous data. */
  loading?: boolean;
  isEmpty: boolean;
  emptyMessage: ReactNode;
  /** DialogContent width class (e.g. "sm:max-w-sm", "sm:max-w-lg"). */
  contentClassName?: string;
  /** Scroll container max-height class (e.g. "max-h-[300px]"). */
  listClassName?: string;
  /** Truncate the description to a single line (for long transaction names). */
  truncateDescription?: boolean;
  /** The rows — rendered inside a space-y-1 list when not loading/empty. */
  children: ReactNode;
}

/** Dialog shell for the searchable pickers: header, search input, scroll list with loading/empty states. */
export function PickerDialog({
  open,
  onOpenChange,
  title,
  description,
  search,
  onSearchChange,
  searchPlaceholder,
  loading,
  isEmpty,
  emptyMessage,
  contentClassName = "sm:max-w-lg",
  listClassName = "max-h-[350px]",
  truncateDescription,
  children,
}: PickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("overflow-hidden", contentClassName)}>
        <DialogHeader className={truncateDescription ? "min-w-0 overflow-hidden" : undefined}>
          <DialogTitle>{title}</DialogTitle>
          {description && (
            <DialogDescription className={truncateDescription ? "truncate" : undefined}>
              {description}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>

        <div className={cn("overflow-y-auto -mx-1 px-1", listClassName)}>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : isEmpty ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {emptyMessage}
            </p>
          ) : (
            <div className="space-y-1">{children}</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
