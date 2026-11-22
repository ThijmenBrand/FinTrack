"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch, ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import { toIsoDate } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/translate";

/**
 * The one thing someone does here regularly: read a number off their broker
 * and write it down. One amount, one date, ten seconds, once a month.
 *
 * Everything else on the page is derived from these entries, so the dialog
 * also shows the history and lets a mistyped figure be removed — a number you
 * cannot correct is a number you stop trusting.
 */

interface Account {
  id: string;
  name: string;
  currentValue: number | null;
  valuedAt: string | null;
}

interface Valuation {
  id: string;
  date: string;
  value: number;
  source: string;
}

export function UpdateValueDialog({ accounts }: { accounts: Account[] }) {
  const { t, formatCurrency, formatDayMonth } = useI18n();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [value, setValue] = useState("");
  const [date, setDate] = useState(() => toIsoDate(new Date()));
  const [history, setHistory] = useState<Valuation[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  const today = toIsoDate(new Date());
  const account = accounts.find((a) => a.id === accountId);

  async function loadHistory(id: string) {
    setHistory(null);
    try {
      setHistory(await apiFetch<Valuation[]>(`/api/accounts/${id}/valuations`));
    } catch {
      setHistory([]);
    }
  }

  function openWith(id: string) {
    setAccountId(id);
    setValue("");
    setDate(today);
    setError(null);
    setOpen(true);
    void loadHistory(id);
  }

  async function save() {
    const amount = parseFloat(value);
    if (!Number.isFinite(amount) || amount < 0) {
      setError("investments.update.invalidValue");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const next = await apiFetch<Valuation[]>(
        `/api/accounts/${accountId}/valuations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: amount, date }),
        },
      );
      setHistory(next);
      setValue("");
      router.refresh();
    } catch (e) {
      setError(
        e instanceof ApiError && e.code
          ? (e.code as MessageKey)
          : "investments.update.failed",
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove(valuationId: string) {
    try {
      const next = await apiFetch<Valuation[]>(
        `/api/accounts/${accountId}/valuations/${valuationId}`,
        { method: "DELETE" },
      );
      setHistory(next);
      router.refresh();
    } catch {
      setError("investments.update.failed");
    }
  }

  if (accounts.length === 0) return null;

  return (
    <>
      <Button onClick={() => openWith(accounts[0].id)}>
        <Plus className="h-4 w-4" />
        {t("investments.update.action")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("investments.update.title")}</DialogTitle>
            <DialogDescription>
              {t("investments.update.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {accounts.length > 1 && (
              <div className="grid gap-2">
                <Label htmlFor="valuation-account">
                  {t("investments.update.accountLabel")}
                </Label>
                <Select
                  value={accountId}
                  onValueChange={(id) => {
                    setAccountId(id);
                    void loadHistory(id);
                  }}
                >
                  <SelectTrigger id="valuation-account">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="valuation-value">
                  {t("investments.update.valueLabel")}
                </Label>
                <Input
                  id="valuation-value"
                  type="number"
                  step="0.01"
                  min="0"
                  autoFocus
                  placeholder={
                    account?.currentValue !== null && account?.currentValue !== undefined
                      ? String(account.currentValue)
                      : "0.00"
                  }
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !saving) void save();
                  }}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="valuation-date">
                  {t("investments.update.dateLabel")}
                </Label>
                <Input
                  id="valuation-date"
                  type="date"
                  max={today}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <p className="text-xs text-red-600 dark:text-red-400">{t(error)}</p>
            )}

            {history !== null && history.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {t("investments.update.historyHeading")}
                </p>
                <ul className="max-h-40 divide-y overflow-y-auto rounded-md border">
                  {history.map((v) => (
                    <li
                      key={v.id}
                      className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm"
                    >
                      <span className="text-muted-foreground">
                        {formatDayMonth(v.date)}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums">{formatCurrency(v.value)}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-red-600"
                          aria-label={t("investments.update.deleteEntry", {
                            date: formatDayMonth(v.date),
                          })}
                          onClick={() => remove(v.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("common.close")}
            </Button>
            <Button onClick={save} disabled={saving || value === ""}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? t("common.saving") : t("investments.update.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
