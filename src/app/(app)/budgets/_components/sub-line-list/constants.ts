import type { ReactNode } from "react";
import type { MessageKey } from "@/lib/i18n/translate";
import { SUB_LINE_ERROR } from "@/lib/budget-sub-lines";

export { MAX_SUB_LINE_DEPTH } from "@/lib/budget-sub-lines";

/** Indent per depth, in each of the two places the list is rendered. */
export const LIST_INDENT = ["pl-9", "pl-12", "pl-16"];
export const DIALOG_INDENT = ["pl-0", "pl-4", "pl-8"];

export const cents = (n: number) => Math.round(n * 100) / 100;

/** Everything a row needs that never changes per row. */
export interface Ctx {
  allocationId: string;
  toDisplay: (stored: number) => number;
  toStored: (shown: number) => number;
  readOnly: boolean;
  variant: "list" | "dialog";
}

export interface RowProps {
  ctx: Ctx;
  depth: number;
  children: ReactNode;
}

/**
 * The endpoint sends a stable `code` with every rule violation precisely so
 * the message can be translated here rather than echoed in English.
 */
export const SUB_LINE_ERROR_KEY: Record<string, MessageKey> = {
  [SUB_LINE_ERROR.exceedsParent]: "budgets.subLines.errExceedsParent",
  [SUB_LINE_ERROR.belowChildren]: "budgets.subLines.errBelowChildren",
  [SUB_LINE_ERROR.tooDeep]: "budgets.subLines.errTooDeep",
  [SUB_LINE_ERROR.tooMany]: "budgets.subLines.errTooMany",
};
