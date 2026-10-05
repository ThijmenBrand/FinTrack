"use client";

import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/client";
import { getNextOccurrence, scheduleForNext, toMonthly } from "@/lib/recurring";
import { toIsoDate } from "@/lib/utils";
import { Loader2, Repeat } from "lucide-react";
import { Row } from "./row";
import { cents, type Ctx } from "./constants";
import type { LineNode, PlanEdit } from "./draft";

const FREQUENCIES = ["weekly", "biweekly", "monthly", "yearly"] as const;

/**
 * The editor for a line that IS a recurring payment.
 *
 * The plain sub-line form only has a name and a monthly figure, which is all a
 * planning line is — but a payment is also a cadence and a date, and those are
 * exactly what goes stale (the rent moved to the 1st, the insurance went
 * yearly). So this one asks for the payment the way the bank sees it: what one
 * payment costs, how often it comes, and when the next one is due. The row's
 * monthly figure follows from those, and says so under the fields when the two
 * differ.
 *
 * "Next payment" rather than a day-of-month and a start date: it is the date
 * the row itself shows, so the field edits the thing that was read.
 */
export function RecurringLineForm({
  ctx,
  depth,
  line,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  ctx: Ctx;
  depth: number;
  line: LineNode & { recurring: NonNullable<LineNode["recurring"]> };
  pending: boolean;
  error: string | null;
  onSubmit: (name: string, plan: PlanEdit) => void;
  onCancel: () => void;
}) {
  const { t, formatCurrency } = useI18n();
  const plan = line.recurring;
  const ids = useId();
  const [name, setName] = useState(line.name);
  const [amount, setAmount] = useState(String(cents(Math.abs(plan.amount))));
  const [frequency, setFrequency] = useState(plan.frequency);
  const [next, setNext] = useState(() =>
    getNextOccurrence(
      plan.frequency,
      plan.startDate,
      plan.dayOfWeek,
      plan.dayOfMonth,
      plan.monthOfYear,
    ),
  );

  // Today has already been and gone as far as `getNextOccurrence` is
  // concerned — a payment due today reads as next period's — so the earliest
  // date this field can promise is tomorrow.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const min = toIsoDate(tomorrow);

  const parsed = parseFloat(amount);
  const valid = !!name.trim() && parsed > 0 && next >= min;
  const monthly = valid ? toMonthly(parsed, frequency) : 0;

  const submit = () => {
    if (!valid || pending) return;
    onSubmit(name.trim(), {
      amount: cents(parsed),
      frequency: frequency as PlanEdit["frequency"],
      ...scheduleForNext(frequency, next, plan.startDate),
    });
  };

  return (
    <Row depth={depth} full>
      <form
        className="my-1 w-full space-y-3 rounded-lg border bg-muted/40 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <Field id={`${ids}-name`} label={t("common.name")}>
          <Input
            id={`${ids}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("budgets.subLines.namePlaceholder")}
            className="bg-background"
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field id={`${ids}-amount`} label={t("budgets.subLines.perPayment")}>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                &euro;
              </span>
              <Input
                id={`${ids}-amount`}
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="bg-background pl-7 tabular-nums"
              />
            </div>
          </Field>
          <Field id={`${ids}-freq`} label={t("recurring.form.frequency")}>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger id={`${ids}-freq`} className="bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map((f) => (
                  <SelectItem key={f} value={f}>
                    {t(`recurring.freq.${f}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            id={`${ids}-next`}
            label={t("budgets.subLines.nextPayment")}
            className="col-span-2 sm:col-span-1"
          >
            <Input
              id={`${ids}-next`}
              type="date"
              min={min}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="bg-background tabular-nums"
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground">
            <Repeat className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              {t("budgets.subLines.planSyncs")}
              {/* Only where the two figures differ: on a monthly payment the
                  row's number already IS the one in the field. */}
              {frequency !== "monthly" && monthly > 0 && (
                <>
                  {" "}
                  {t("budgets.subLines.monthlyEquivalent", {
                    amount: formatCurrency(cents(ctx.toDisplay(monthly))),
                  })}
                </>
              )}
            </span>
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={pending || !valid}>
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {t("common.save")}
            </Button>
          </div>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
      </form>
    </Row>
  );
}

function Field({
  id,
  label,
  className = "",
  children,
}: {
  id: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`grid gap-1.5 ${className}`}>
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
