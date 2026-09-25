"use client";

import { useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BankLogo } from "@/components/bank-logo";
import { CategoryPicker } from "@/components/category-picker";
import { useCategories } from "@/hooks/use-categories";
import { useBudgets } from "@/hooks/use-budgets";
import { useCreateTransaction } from "@/hooks/use-transactions";
import { ApiError } from "@/lib/api";
import { parseAmount } from "@/lib/csv-utils";
import { cn, toIsoDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import type { Account } from "@/types/api";

type Direction = "expense" | "income";

/**
 * What the user typed, as a positive amount in cents-exact euros — or null
 * when it isn't one. The direction toggle carries the sign, so a typed minus
 * is forgiven rather than doubled; "12,50" and "1.234,56" read the Dutch way.
 */
export function parseManualAmount(raw: string): number | null {
  if (!raw.trim()) return null;
  const n = Math.abs(parseAmount(raw));
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n * 100) / 100;
  return rounded > 0 ? rounded : null;
}

function Form({
  accounts,
  defaultAccountId,
  onDone,
}: {
  accounts: Account[];
  defaultAccountId?: string;
  onDone: () => void;
}) {
  const { t, formatCurrency } = useI18n();
  const create = useCreateTransaction();
  const amountRef = useRef<HTMLInputElement>(null);

  // A viewer's write would 403; they never see the account here at all.
  const writable = useMemo(() => accounts.filter((a) => a.role !== "viewer"), [accounts]);

  const [direction, setDirection] = useState<Direction>("expense");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => toIsoDate(new Date()));
  const [description, setDescription] = useState("");
  const [accountId, setAccountId] = useState(() => {
    if (defaultAccountId && writable.some((a) => a.id === defaultAccountId)) return defaultAccountId;
    return writable.length === 1 ? writable[0].id : "";
  });
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastAdded, setLastAdded] = useState<string | null>(null);

  const account = writable.find((a) => a.id === accountId);

  // Categories live in the account OWNER's space — a member's own ids are
  // rejected on a shared account — so the list follows the account.
  const { data: categories = [] } = useCategories(accountId || undefined);
  const budgetId = account?.budgetId ?? null;
  const { data: budget } = useBudgets({
    budgetId: budgetId ?? undefined,
    noScale: true,
    enabled: !!budgetId,
  });
  const budgetCategoryIds = useMemo(() => {
    if (!budgetId || !budget) return null;
    const planned = [
      ...budget.allocations.map((a) => a.categoryId),
      ...budget.fixedCosts.map((f) => f.categoryId),
    ];
    return planned.length === 0 ? null : new Set(planned);
  }, [budgetId, budget]);

  const parsed = parseManualAmount(amount);
  const valid =
    parsed != null && !!description.trim() && !!account && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const signed = parsed == null ? null : direction === "expense" ? -parsed : parsed;

  const submit = async (another: boolean) => {
    if (!valid || signed == null || !account || create.isPending) return;
    setError(null);
    try {
      await create.mutateAsync({
        accountId,
        date,
        description: description.trim(),
        amount: signed,
        type: direction,
        categoryId,
        notes: notes.trim() || null,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
      return;
    }
    if (!another) {
      onDone();
      return;
    }
    // Direction, account and date stay: the next row is usually its
    // counterpart (the +€50 beside a −€50) or another from the same day.
    setLastAdded(
      t("tx.add.added", {
        amount: formatCurrency(signed, account.currency),
        description: description.trim(),
      }),
    );
    setAmount("");
    setDescription("");
    setCategoryId(null);
    setNotes("");
    amountRef.current?.focus();
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      <Segmented
        name="add-transaction-direction"
        legend={t("common.type")}
        value={direction}
        onChange={setDirection}
        options={[
          { value: "expense", label: t("tx.type.expense") },
          { value: "income", label: t("tx.type.income") },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="add-tx-amount">{t("common.amount")}</Label>
          <div className="relative">
            {/* The sign is the direction toggle's, shown where the number is
                read, so a −€50 is never mistaken for money coming in. */}
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-sm tabular-nums",
                direction === "expense"
                  ? "text-red-600 dark:text-red-400"
                  : "text-emerald-600 dark:text-emerald-400",
              )}
            >
              {direction === "expense" ? "−" : "+"}€
            </span>
            <Input
              ref={amountRef}
              id="add-tx-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={amount !== "" && parsed == null}
              className="pl-9 font-mono tabular-nums"
              autoFocus
              aria-describedby="add-tx-amount-reading"
            />
          </div>
          {/* Echo the amount as it will be saved: "1.234" is €1,23 to the
              parser, not the €1.234 a Dutch reader may have meant. */}
          <p
            id="add-tx-amount-reading"
            className="min-h-4 text-xs tabular-nums text-muted-foreground"
          >
            {signed != null && formatCurrency(signed, account?.currency ?? "EUR")}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="add-tx-date">{t("common.date")}</Label>
          <Input
            id="add-tx-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="add-tx-description">{t("common.description")}</Label>
        <Input
          id="add-tx-description"
          placeholder={t("tx.add.descriptionPlaceholder")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={200}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="add-tx-account">{t("common.account")}</Label>
        <Select
          value={accountId}
          onValueChange={(id) => {
            setAccountId(id);
            // Another owner's account has another category space; a pick from
            // the old one would 404 on save.
            if (writable.find((a) => a.id === id)?.userId !== account?.userId) setCategoryId(null);
          }}
        >
          <SelectTrigger id="add-tx-account" className="w-full">
            <SelectValue placeholder={t("csv.selectAccount")} />
          </SelectTrigger>
          <SelectContent>
            {writable.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                <span className="flex items-center gap-2">
                  <BankLogo bank={a.bank} size={20} />
                  {a.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>
          {t("common.category")}{" "}
          <span className="font-normal text-muted-foreground">({t("common.optional")})</span>
        </Label>
        {/* Keyed by account: the picker's create-on-the-fly writes into the
            account owner's space, fixed when it mounts. */}
        <CategoryPicker
          key={accountId}
          categories={categories}
          budgetCategoryIds={budgetCategoryIds}
          value={categoryId}
          onChange={(id) => setCategoryId(id)}
          accountId={accountId || undefined}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="add-tx-notes">
          {t("common.notes")}{" "}
          <span className="font-normal text-muted-foreground">({t("common.optional")})</span>
        </Label>
        <Textarea
          id="add-tx-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("tx.add.notesPlaceholder")}
        />
      </div>

      {/* Always mounted so the confirmation is announced; sr-only while empty
          so it adds no gap above the footer. */}
      <div aria-live="polite" className={cn("text-sm", !error && !lastAdded && "sr-only")}>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {!error && lastAdded && <p className="text-muted-foreground">{lastAdded}</p>}
      </div>

      <DialogFooter className="gap-2 sm:space-x-0">
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!valid || create.isPending}
          onClick={() => submit(true)}
        >
          {t("tx.add.saveAndAnother")}
        </Button>
        <Button type="submit" disabled={!valid || create.isPending}>
          {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("tx.add.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Hand-enter one income or expense row: cash, or a cost booked on the account
 * whose budget it belongs to when it was paid from another. Everything else
 * arrives by CSV import.
 */
export function AddTransactionDialog({
  open,
  onOpenChange,
  accounts,
  defaultAccountId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: Account[];
  /** Preselected when the list is already narrowed to this one account. */
  defaultAccountId?: string;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("tx.add.title")}</DialogTitle>
          <DialogDescription>{t("tx.add.description")}</DialogDescription>
        </DialogHeader>
        {/* Unmounted on close, so every open starts from a clean form. */}
        {open && (
          <Form
            accounts={accounts}
            defaultAccountId={defaultAccountId}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
