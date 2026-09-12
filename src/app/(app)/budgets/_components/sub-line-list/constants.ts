import type { MessageKey } from "@/lib/i18n/translate";
import { SUB_LINE_ERROR } from "@/lib/budget-sub-lines";
import type { LineNode } from "./draft";

export { MAX_SUB_LINE_DEPTH } from "@/lib/budget-sub-lines";

export const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * What a row does when the user acts on it. The editor fills these with draft
 * edits and the budget view leaves them null — which is the entire difference
 * between drafting a tree and reading one, so it is the only thing the two
 * have to supply separately. Amounts are in stored units; whatever a call
 * rejects with is left to reach the row that fired it.
 */
export interface TreeActions {
  /** `parentId` null adds a line directly under the allocation. */
  add(parentId: string | null, name: string, amount: number): Promise<unknown> | void;
  update(id: string, name: string, amount: number): Promise<unknown> | void;
  remove(line: LineNode): Promise<unknown> | void;
}

/** Everything a row needs that never changes per row. */
export interface Ctx {
  /** The category's colour, repeated on the sub-rows in the page list. */
  color: string | null;
  toDisplay: (stored: number) => number;
  toStored: (shown: number) => number;
  /** Null when the tree is read-only — no add, edit or delete affordances. */
  actions: TreeActions | null;
}

/**
 * The endpoint sends a stable `code` with every rule violation precisely so
 * the message can be translated here rather than echoed in English.
 */
export const SUB_LINE_ERROR_KEY: Record<string, MessageKey> = {
  [SUB_LINE_ERROR.tooDeep]: "budgets.subLines.errTooDeep",
  [SUB_LINE_ERROR.tooMany]: "budgets.subLines.errTooMany",
};
