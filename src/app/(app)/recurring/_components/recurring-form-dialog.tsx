"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BankLogo } from "@/components/bank-logo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Info, Loader2, Plus } from "lucide-react";
import type { Account, CategoryWithDetails, RecurringTx } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";

/**
 * The (i) beside a field label, explaining why the field is narrowed or locked.
 * A popover rather than a tooltip: this is read on a phone too, and a hover
 * tooltip never opens there.
 */
function FieldInfo({ note }: { note: string }) {
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-label={note}
        className="text-muted-foreground hover:text-foreground"
      >
        <Info className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3 text-xs font-normal">
        {note}
      </PopoverContent>
    </Popover>
  );
}

/** Locale's own short weekday names, Sunday-first to match dayOfWeek 0–6. */
function weekdayNames(intlLocale: string): string[] {
  const fmt = new Intl.DateTimeFormat(intlLocale, { weekday: "short" });
  // 2024-01-07 was a Sunday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 7 + i)));
}

/**
 * Seeds the create form's fields without switching the dialog into edit mode —
 * for a caller that already knows the answer (a sub-line's name and amount)
 * but is creating a brand new plan, not editing one. `id` keys the remount the
 * same way `editing.id` does, so moving to another target re-derives fields.
 */
export type RecurringPrefill = Pick<RecurringTx, "id" | "accountId" | "description" | "amount"> &
  Partial<Pick<RecurringTx, "categoryId" | "frequency" | "dayOfWeek" | "dayOfMonth" | "startDate">>;

export function RecurringFormDialog({
  open,
  onOpenChange,
  editing,
  prefill,
  defaultType,
  accounts,
  accountNote,
  categories,
  lockedCategoryId,
  onSubmit,
  trigger,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: RecurringTx | null;
  /** Ignored when `editing` is set. Seeds a create; never renders as "Edit". */
  prefill?: RecurringPrefill | null;
  /** Which type a fresh create starts on — the section the add came from. */
  defaultType?: "income" | "expense";
  /** Already narrowed by the caller — a budget plan passes only its own. */
  accounts: Account[];
  /** Explains a narrowed `accounts` list; renders as an (i) beside the label. */
  accountNote?: string;
  categories: CategoryWithDetails[];
  /**
   * The add started from a category row, so the answer is already known: seed
   * it and lock the field rather than letting it be filed somewhere else.
   */
  lockedCategoryId?: string;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  /** Page-level default is a primary button; list sections pass a quieter one. */
  trigger?: ReactNode;
}) {
  const { t } = useI18n();
  const seed = editing ?? prefill ?? null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            {t("recurring.add")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {/* Remount on open/target change so fields re-derive from the seed without an effect. */}
        {open && (
          <RecurringFormBody
            key={seed?.id ?? `${defaultType ?? "new"}:${lockedCategoryId ?? ""}`}
            editing={editing}
            defaultType={defaultType}
            seed={seed}
            accounts={accounts}
            accountNote={accountNote}
            categories={categories}
            lockedCategoryId={lockedCategoryId}
            onSubmit={onSubmit}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RecurringFormBody({
  editing,
  seed,
  defaultType,
  accounts,
  accountNote,
  categories,
  lockedCategoryId,
  onSubmit,
  onCancel,
}: {
  editing: RecurringTx | null;
  seed: RecurringTx | RecurringPrefill | null;
  defaultType?: "income" | "expense";
  accounts: Account[];
  accountNote?: string;
  categories: CategoryWithDetails[];
  lockedCategoryId?: string;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const { t, intlLocale } = useI18n();
  // Nothing to choose when the caller left one account in scope: pick it and
  // lock the field, with `accountNote` explaining why it can't be changed.
  const locked = accounts.length === 1;
  const [fAccountId, setFAccountId] = useState(
    seed?.accountId ?? (locked ? accounts[0].id : "")
  );
  const [fDescription, setFDescription] = useState(seed?.description ?? "");
  const [fAmount, setFAmount] = useState(
    seed ? String(Math.abs(seed.amount)) : ""
  );
  const [fType, setFType] = useState<"income" | "expense">(
    (editing?.type as "income" | "expense") ?? defaultType ?? "expense"
  );
  const [fCategoryId, setFCategoryId] = useState(
    lockedCategoryId ?? seed?.categoryId ?? ""
  );
  const [fFrequency, setFFrequency] = useState(seed?.frequency ?? "monthly");
  const [fDayOfWeek, setFDayOfWeek] = useState(String(seed?.dayOfWeek ?? 1));
  const [fDayOfMonth, setFDayOfMonth] = useState(
    String(seed?.dayOfMonth ?? 1)
  );
  const [fStartDate, setFStartDate] = useState(
    seed?.startDate ?? new Date().toISOString().slice(0, 10)
  );
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const amount = parseFloat(fAmount);
    if (!amount || !fAccountId || !fDescription || submitting) return;

    setSubmitting(true);
    try {
      await onSubmit({
        accountId: fAccountId,
        description: fDescription,
        amount,
        type: fType,
        categoryId: fCategoryId || null,
        frequency: fFrequency,
        dayOfWeek: fFrequency === "weekly" ? parseInt(fDayOfWeek) : null,
        dayOfMonth:
          fFrequency === "monthly" || fFrequency === "yearly"
            ? parseInt(fDayOfMonth)
            : null,
        startDate: fStartDate,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {editing ? t("recurring.form.editTitle") : t("recurring.form.addTitle")}
        </DialogTitle>
        <DialogDescription>
          {editing
            ? t("recurring.form.editDescription")
            : t("recurring.form.addDescription")}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label>{t("common.type")}</Label>
            <Select
              value={fType}
              onValueChange={(v) => setFType(v as "income" | "expense")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">{t("common.expense")}</SelectItem>
                <SelectItem value="income">{t("common.income")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label className="flex items-center gap-1">
              {t("common.account")}
              {accountNote && <FieldInfo note={accountNote} />}
            </Label>
            <Select value={fAccountId} onValueChange={setFAccountId} disabled={locked}>
              <SelectTrigger>
                <SelectValue placeholder={t("recurring.form.accountPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    <span className="flex items-center gap-2">
                      <BankLogo bank={a.bank} size={24} />
                      {a.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-2">
          <Label>{t("common.description")}</Label>
          <Input
            placeholder={t("recurring.form.descriptionPlaceholder")}
            value={fDescription}
            onChange={(e) => setFDescription(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label>{t("common.amount")}</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                &euro;
              </span>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={fAmount}
                onChange={(e) => setFAmount(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label className="flex items-center gap-1">
              {t("common.category")}
              {lockedCategoryId && (
                <FieldInfo note={t("recurring.form.categoryLockedNote")} />
              )}
            </Label>
            <Select
              value={fCategoryId}
              onValueChange={setFCategoryId}
              disabled={Boolean(lockedCategoryId)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("recurring.form.categoryPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{
                          backgroundColor: c.color || "#94a3b8",
                        }}
                      />
                      {c.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label>{t("recurring.form.frequency")}</Label>
            <Select value={fFrequency} onValueChange={setFFrequency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">{t("recurring.freq.weekly")}</SelectItem>
                <SelectItem value="biweekly">{t("recurring.freq.biweekly")}</SelectItem>
                <SelectItem value="monthly">{t("recurring.freq.monthly")}</SelectItem>
                <SelectItem value="yearly">{t("recurring.freq.yearly")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {fFrequency === "weekly" && (
            <div className="grid gap-2">
              <Label>{t("recurring.form.dayOfWeek")}</Label>
              <Select value={fDayOfWeek} onValueChange={setFDayOfWeek}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {weekdayNames(intlLocale).map((label, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {(fFrequency === "monthly" || fFrequency === "yearly") && (
            <div className="grid gap-2">
              <Label>{t("recurring.form.dayOfMonth")}</Label>
              <Input
                type="number"
                min="1"
                max="31"
                value={fDayOfMonth}
                onChange={(e) => setFDayOfMonth(e.target.value)}
              />
            </div>
          )}
        </div>
        <div className="grid gap-2">
          <Label>{t("recurring.form.startDate")}</Label>
          <Input
            type="date"
            value={fStartDate}
            onChange={(e) => setFStartDate(e.target.value)}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!fAccountId || !fDescription || !fAmount || submitting}
        >
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {editing ? t("accounts.saveChanges") : t("common.create")}
        </Button>
      </DialogFooter>
    </>
  );
}
