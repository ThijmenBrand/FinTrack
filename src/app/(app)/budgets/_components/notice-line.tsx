"use client";

import type { ComponentType, ReactNode } from "react";

/**
 * A single line of page-level news — an over-allocation, a pending set of
 * suggestions. These used to be full cards, which gave a passing remark the
 * same weight as the plan itself.
 */
export function NoticeLine({
  icon: Icon,
  filled = false,
  iconTone = "text-amber-600 dark:text-amber-400",
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  /** Actionable notices sit on a tinted strip; warnings are bare text. */
  filled?: boolean;
  iconTone?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-sm ${
        filled ? "rounded-lg bg-muted px-3.5 py-2.5" : ""
      }`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${iconTone}`} aria-hidden="true" />
      {children}
    </div>
  );
}
