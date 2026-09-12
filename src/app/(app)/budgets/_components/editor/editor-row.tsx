"use client";

import { useState, type ReactNode } from "react";
import { Repeat, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/client";
import { ROW_BRACKET, ROW_SHELL, ROW_TWIST } from "../budget-row";
import { cents } from "../sub-line-list/constants";

/**
 * A line of the plan, as it is written rather than as it is tracked.
 *
 * The same geometry as the budget view's row — dot at 48px, name at 64px,
 * children hanging off the hairline at 52px — so switching between the two
 * modes moves nothing on screen except what the row is FOR. What changes is
 * everything the view row spends its width on: no progress bar, no spend, no
 * status colour. Those describe a month; this describes a plan.
 *
 * The past is not gone though, just demoted: the reference line under the name
 * says what this category actually costs, and opens the full history. Setting
 * a number without it is guessing.
 */
export function EditorRow({
  name,
  color,
  unit,
  /** The averages line: what this category has really been costing. */
  reference,
  onHistory,
  /** Right-hand cell. A field, or a figure when something else derives it. */
  control,
  removed = false,
  onRemove,
  onRestore,
  children,
}: {
  name: string | null;
  color: string | null;
  unit?: string;
  reference?: string;
  onHistory?: () => void;
  control: ReactNode;
  removed?: boolean;
  onRemove?: () => void;
  onRestore?: () => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();

  return (
    <li className={removed ? "bg-destructive/[0.04]" : undefined}>
      <div className={`${ROW_SHELL} items-center`}>
        {/* Empty, and the same 32px the view's twist takes: the two lists have
            to agree on where a name starts or the switch between them reads as
            the page jumping. */}
        <span className={ROW_TWIST} aria-hidden="true" />

        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${removed ? "opacity-40" : ""}`}
              style={{ backgroundColor: color || "#94a3b8" }}
            />
            <span
              className={`truncate text-sm font-medium sm:text-[0.9375rem] ${
                // A full-strength rule, not the muted one a paused sub-line
                // wears: this row is about to be deleted, and that has to read
                // at a glance from the other end of a long list.
                removed ? "text-muted-foreground line-through decoration-2" : ""
              }`}
            >
              {name}
            </span>
          </span>
          {/* Under the name, at the name's own indent — a quiet second line
              rather than a column, so it survives a phone without stealing
              width from the field beside it. One line, always: it is a
              reference, and three wrapped lines of it outweigh the row. */}
          <span className="ml-4 mt-0.5 block truncate text-xs text-muted-foreground">
            {removed ? (
              t("budgets.editor.willBeRemoved")
            ) : onHistory && reference ? (
              <button
                type="button"
                onClick={onHistory}
                className="max-w-full truncate underline decoration-dotted underline-offset-2 hover:text-foreground"
              >
                {reference}
              </button>
            ) : (
              reference
            )}
          </span>
        </span>

        {removed ? (
          <Button variant="ghost" size="sm" className="ml-3 h-8" onClick={onRestore}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            {t("budgets.editor.undo")}
          </Button>
        ) : (
          <>
            <span className="ml-3 flex items-center gap-1.5">
              {control}
              {/* Shown at every width: on a yearly plan this is the only thing
                  on the row saying the figure is a year's, and a monthly
                  reading of it would be twelve times wrong. */}
              {unit && (
                <span className="text-xs text-muted-foreground">{unit}</span>
              )}
            </span>
            {onRemove && (
              <Button
                variant="ghost"
                size="icon"
                className="ml-1 h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={onRemove}
                aria-label={t("budgets.editor.removeCategory", { name: name ?? "" })}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </>
        )}
      </div>

      {/* Struck-through rows keep their breakdown out of the way: it is going
          with them, and it cannot be edited on the way out. */}
      {children && !removed && <ul className={ROW_BRACKET}>{children}</ul>}
    </li>
  );
}

/**
 * The amount field.
 *
 * Buffered as text while it is being typed — "1", "1.", "1.5" are all states a
 * number field passes through and none of them should reach the draft — and
 * committed on blur or Enter. A value that is not a positive number snaps back
 * to what it was: the endpoint refuses those, and a field that silently keeps
 * an unsaveable figure would fail at Save with nothing on screen explaining it.
 */
export function AmountField({
  value,
  onCommit,
  label,
}: {
  /** Display units, already converted. */
  value: number;
  onCommit: (next: number) => void;
  label: string;
}) {
  const [text, setText] = useState(() => String(cents(value)));
  // Re-seed when the value changes from elsewhere — a sub-line edit rolling up
  // into this total, or a discard. Adjusting state during render rather than in
  // an effect, which is what React documents for exactly this.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(String(cents(value)));
  }

  const commit = () => {
    const parsed = parseFloat(text);
    if (!isFinite(parsed) || parsed <= 0) {
      setText(String(cents(value)));
      return;
    }
    if (cents(parsed) !== cents(value)) onCommit(cents(parsed));
    setText(String(cents(parsed)));
  };

  return (
    <span className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        &euro;
      </span>
      <Input
        type="number"
        step="0.01"
        min="0.01"
        inputMode="decimal"
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="h-9 w-28 pl-6 text-right tabular-nums sm:w-32"
      />
    </span>
  );
}

/**
 * What stands in for the field when the number is not this row's to type: a
 * category that adds up from its breakdown, or one whose whole cost is a set
 * of recurring payments. Stated as a figure rather than a disabled input —
 * a greyed-out field still invites a click, and this one never accepts one.
 */
export function DerivedAmount({
  amount,
  hint,
  icon = false,
}: {
  amount: string;
  hint: string;
  icon?: boolean;
}) {
  return (
    // Sized to the figure, with the field's width as its floor: an ellipsised
    // amount reads as a different number than the one budgeted, so the column
    // gives way before the money does.
    <span
      className="flex h-9 min-w-28 shrink-0 items-center justify-end gap-1.5 rounded-md border border-dashed px-2.5 sm:min-w-32"
      title={hint}
    >
      {icon && (
        <Repeat className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <span className="whitespace-nowrap text-sm font-medium tabular-nums">
        {amount}
      </span>
    </span>
  );
}
