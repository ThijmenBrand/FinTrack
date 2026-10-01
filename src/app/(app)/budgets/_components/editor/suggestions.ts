import type { Allocation, BudgetSuggestion } from "@/types/api";
import { overlay, type Draft, type EditorRow, type NewAllocation } from "./draft";

/**
 * Generated suggestions, reviewed in place.
 *
 * A suggestion is not a list of its own here: it is shown on the row it would
 * change, or where the row it would add is going to appear, and answering it
 * is a drafted edit like any other on the page. Accepting writes the amount
 * into the draft — so the figures at the top move — and Save is still the one
 * thing that writes. That is what keeps "nothing is saved until you press
 * Save" true on a page that also proposes changes of its own.
 */

/** The row a suggestion lands on, if the plan already has one for its category. */
export function suggestionTarget(
  rows: readonly EditorRow[],
  suggestion: BudgetSuggestion,
): EditorRow | undefined {
  // A row on its way out is not a target: accepting would type over a delete.
  // The suggestion reads as a new line instead, which is what it would be.
  return rows.find((r) => r.categoryId === suggestion.categoryId && !r.removed);
}

/**
 * Whether the row's total is one a suggestion can set. A row with a breakdown
 * adds up from its lines, and an amount drafted over it would be ignored by
 * the roll-up — so on those a suggestion can only be read and declined.
 */
export function settable(row: EditorRow): boolean {
  return row.subLines.length + (row.lines?.length ?? 0) === 0;
}

/** Suggestions with no answer yet in this session. */
export function pendingSuggestions(
  suggestions: readonly BudgetSuggestion[],
  draft: Draft,
): BudgetSuggestion[] {
  return suggestions.filter((s) => !draft.decided[s.id]);
}

/** The local key of a row an accepted suggestion added. */
export const suggestedKey = (suggestionId: string) => `suggestion:${suggestionId}`;

/**
 * Take the suggested amount: over the category's row if it has one, as a new
 * row if it doesn't. A no-op on a row whose total is set by its lines.
 */
export function acceptSuggestion(
  draft: Draft,
  suggestion: BudgetSuggestion,
  allocations: Allocation[],
): Draft {
  if (draft.decided[suggestion.id]) return draft;
  const amount = suggestion.suggestedAmount;
  const row = suggestionTarget(overlay(allocations, draft), suggestion);

  if (!row) {
    const key = suggestedKey(suggestion.id);
    return {
      ...draft,
      added: [
        ...draft.added,
        {
          key,
          categoryId: suggestion.categoryId,
          categoryName: suggestion.categoryName,
          categoryColor: suggestion.categoryColor,
          amount,
          lines: [],
        } satisfies NewAllocation,
      ],
      decided: {
        ...draft.decided,
        [suggestion.id]: { kind: "accepted", rowId: key, created: true },
      },
    };
  }

  if (!settable(row)) return draft;

  const prev = row.isNew
    ? draft.added.find((a) => a.key === row.id)?.amount
    : draft.amounts[row.id];
  return {
    ...draft,
    ...(row.isNew
      ? {
          added: draft.added.map((a) => (a.key === row.id ? { ...a, amount } : a)),
        }
      : { amounts: { ...draft.amounts, [row.id]: amount } }),
    decided: {
      ...draft.decided,
      [suggestion.id]: { kind: "accepted", rowId: row.id, created: false, prev },
    },
  };
}

export function declineSuggestion(draft: Draft, suggestionId: string): Draft {
  if (draft.decided[suggestionId]) return draft;
  return {
    ...draft,
    decided: { ...draft.decided, [suggestionId]: { kind: "declined" } },
  };
}

/**
 * Take an answer back: the suggestion is pending again, and whatever its
 * accept changed is put back the way it was — the row it added goes, or the
 * amount it typed over returns to the one before it.
 */
export function undoSuggestion(draft: Draft, suggestionId: string): Draft {
  const decision = draft.decided[suggestionId];
  if (!decision) return draft;
  const decided = { ...draft.decided };
  delete decided[suggestionId];
  if (decision.kind === "declined") return { ...draft, decided };

  const { rowId, created, prev } = decision;
  if (created) {
    return {
      ...draft,
      decided,
      added: draft.added.filter((a) => a.key !== rowId),
      removed: draft.removed.filter((id) => id !== rowId),
    };
  }
  if (draft.added.some((a) => a.key === rowId)) {
    return {
      ...draft,
      decided,
      added: draft.added.map((a) =>
        a.key === rowId && prev !== undefined ? { ...a, amount: prev } : a,
      ),
    };
  }
  const amounts = { ...draft.amounts };
  if (prev === undefined) delete amounts[rowId];
  else amounts[rowId] = prev;
  return { ...draft, decided, amounts };
}

/** The accepted suggestion behind a row, if one landed on it this session. */
export function acceptedOn(
  draft: Draft,
  rowId: string,
): string | undefined {
  return Object.entries(draft.decided).find(
    ([, d]) => d.kind === "accepted" && d.rowId === rowId,
  )?.[0];
}
