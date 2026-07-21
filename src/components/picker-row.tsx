"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface PickerRowProps {
  onClick?: () => void;
  disabled?: boolean;
  /** When true, the leading slot shows a spinner instead of `leading`. */
  loading?: boolean;
  /** Leading indicator shown when not loading (e.g. a colour dot or spacer). */
  leading?: ReactNode;
  /** Trailing content, typically an amount. */
  trailing?: ReactNode;
  /** Extra classes for state/hover/padding (default padding is py-2). */
  className?: string;
  children: ReactNode;
}

/** One selectable row inside a PickerDialog: styled button, spinner-aware leading slot, trailing content. */
export function PickerRow({
  onClick,
  disabled,
  loading,
  leading,
  trailing,
  className,
  children,
}: PickerRowProps) {
  return (
    <button
      className={cn(
        "w-full flex items-center rounded-lg border px-3 py-2 text-left transition-colors",
        className
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin shrink-0 mr-3 text-muted-foreground" />
      ) : (
        leading
      )}
      <div className="min-w-0 flex-1">{children}</div>
      {trailing}
    </button>
  );
}
