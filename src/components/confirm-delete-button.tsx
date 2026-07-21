"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Trash2, X, Loader2 } from "lucide-react";

interface ConfirmDeleteButtonProps {
  /** Called when the user confirms. May be async — the button shows pending while it resolves. */
  onConfirm: () => void | Promise<void>;
  /** External pending flag (e.g. a mutation's isPending). */
  pending?: boolean;
  disabled?: boolean;
  /**
   * "icon" (default) — a trash icon that swaps to [trash | X] icon buttons, for list rows.
   * "text" — a labelled trigger that expands to an inline [message] [Cancel] [Delete] strip.
   */
  variant?: "icon" | "text";
  /** Idle-trigger label (text variant) and aria-label (both variants). */
  label?: string;
  /** Confirm-button label (text variant). Defaults to "Delete". */
  confirmLabel?: string;
  /** Explanatory message shown while confirming (text variant only). */
  message?: ReactNode;
  /** Extra classes for the idle trigger button. */
  className?: string;
}

export function ConfirmDeleteButton({
  onConfirm,
  pending,
  disabled,
  variant = "icon",
  label = "Delete",
  confirmLabel = "Delete",
  message,
  className,
}: ConfirmDeleteButtonProps) {
  const [confirming, setConfirming] = useState(false);

  const confirm = async () => {
    await onConfirm();
    setConfirming(false);
  };

  if (variant === "text") {
    if (!confirming) {
      return (
        <Button
          variant="outline"
          size="sm"
          className={cn("text-destructive hover:text-destructive", className)}
          onClick={() => setConfirming(true)}
          disabled={disabled}
        >
          <Trash2 className="h-4 w-4" />
          {label}
        </Button>
      );
    }
    return (
      <div className="rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 p-3 flex items-center justify-between gap-3">
        {message && <p className="text-sm">{message}</p>}
        <div className="flex gap-2 shrink-0 ml-auto">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirming(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={confirm}
            disabled={pending}
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            {confirmLabel}
          </Button>
        </div>
      </div>
    );
  }

  // icon variant
  if (!confirming) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7 text-muted-foreground hover:text-destructive", className)}
        onClick={() => setConfirming(true)}
        disabled={disabled}
        aria-label={label}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    );
  }
  return (
    <>
      <Button
        variant="destructive"
        size="icon"
        className="h-7 w-7"
        onClick={confirm}
        disabled={pending}
        aria-label={`Confirm ${label.toLowerCase()}`}
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7"
        onClick={() => setConfirming(false)}
        disabled={pending}
        aria-label={`Cancel ${label.toLowerCase()}`}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </>
  );
}
