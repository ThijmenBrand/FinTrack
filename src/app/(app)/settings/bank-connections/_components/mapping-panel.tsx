"use client";

import { useState } from "react";
import { ArrowRight, Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsPanel } from "@/components/settings/settings-ui";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import type { Account } from "@/types/api";
import type { BankConnectionView } from "@/hooks/use-bank-sync";
import { StepUpCancelled } from "@/hooks/use-step-up";
import { cn } from "@/lib/utils";
import { BankMark, formatIban } from "./bank-mark";

type Run = <T>(fn: () => Promise<T>) => Promise<T>;

const NEW = "__new__";
const SKIP = "__skip__";

interface Choice {
  target: string; // account id, NEW or SKIP
  name: string;
  syncFrom: string;
}

/**
 * The last step of connecting: which FinTrack account each bank account
 * feeds, and from which day. Matched by IBAN where possible; the start date
 * defaults to the day after the newest row already there, so CSV history is
 * never imported twice.
 *
 * Right after the trip to the bank, `authStateId` authorises the save; later
 * (or for an account skipped then) it takes a fresh step-up.
 */
export function MappingPanel({
  connection,
  authStateId,
  accounts,
  linkedAccountIds,
  run,
  onDone,
  onCancel,
}: {
  connection: BankConnectionView;
  authStateId?: string;
  accounts: Account[];
  /** FinTrack accounts some bank account already feeds. */
  linkedAccountIds: Set<string>;
  run: Run;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const own = accounts.filter((a) => a.role === "owner" && !linkedAccountIds.has(a.id));
  const today = new Date().toISOString().slice(0, 10);
  const unlinked = connection.accounts.filter((a) => !a.linkedAccountId);
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(
      unlinked.map((a) => [
        a.uid,
        {
          target: a.suggestedAccountId ?? NEW,
          name: a.name || connection.aspspName,
          syncFrom: a.suggestedSyncFrom,
        },
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (uid: string, patch: Partial<Choice>) =>
    setChoices((c) => ({ ...c, [uid]: { ...c[uid], ...patch } }));

  const chosen = Object.entries(choices).filter(([, c]) => c.target !== SKIP);
  const takenTwice = new Set(
    chosen.map(([, c]) => c.target).filter((v, i, all) => v !== NEW && all.indexOf(v) !== i),
  );

  async function save() {
    setBusy(true);
    setError(null);
    const links = chosen.map(([uid, c]) => ({
      uid,
      syncFrom: c.syncFrom,
      ...(c.target === NEW ? { newAccount: { name: c.name, type: "checking" } } : { accountId: c.target }),
    }));
    const post = (url: string, body: object) =>
      apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    try {
      if (authStateId) await post("/api/bank-sync/links", { authStateId, links });
      else await run(() => post(`/api/bank-sync/connections/${connection.id}/links`, { links }));
      onDone();
    } catch (e) {
      if (!(e instanceof StepUpCancelled)) setError(e instanceof Error ? e.message : t("common.somethingWentWrong"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsPanel title="bankSync.mapping.title" description="bankSync.mapping.description" icon={Link2}>
      <div className="flex items-center gap-3 px-5 py-3">
        <BankMark name={connection.aspspName} />
        <p className="min-w-0 truncate text-sm font-semibold">
          {connection.aspspName}
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">{connection.aspspCountry}</span>
        </p>
      </div>
      {unlinked.map((a) => {
        const c = choices[a.uid];
        const skipped = c.target === SKIP;
        return (
          <div
            key={a.uid}
            className="grid gap-x-4 gap-y-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto_14rem_9.5rem] sm:items-start"
          >
            <div className={cn("min-w-0 sm:pt-[1.375rem]", skipped && "opacity-50")}>
              <p className="truncate text-sm font-medium">{a.name || connection.aspspName}</p>
              {a.iban && (
                <p className="truncate font-mono text-xs tracking-tight text-muted-foreground">{formatIban(a.iban)}</p>
              )}
            </div>
            <ArrowRight
              aria-hidden
              className="hidden h-4 w-4 text-muted-foreground sm:mt-[2.125rem] sm:block"
            />
            <div className="space-y-1.5">
              <label htmlFor={`map-${a.uid}`} className="block text-xs font-medium text-muted-foreground">
                {t("bankSync.mapping.targetLabel")}
              </label>
              <Select value={c.target} onValueChange={(v) => set(a.uid, { target: v })} disabled={busy}>
                <SelectTrigger id={`map-${a.uid}`} aria-label={t("bankSync.mapping.target", { name: a.name || a.uid })}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NEW}>{t("bankSync.mapping.newAccount")}</SelectItem>
                  {own.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={SKIP}>{t("bankSync.mapping.skip")}</SelectItem>
                </SelectContent>
              </Select>
              {c.target === NEW && (
                <Input
                  value={c.name}
                  onChange={(e) => set(a.uid, { name: e.target.value })}
                  aria-label={t("bankSync.mapping.newName")}
                  placeholder={t("bankSync.mapping.newName")}
                  maxLength={100}
                  disabled={busy}
                />
              )}
              {takenTwice.has(c.target) && (
                <p className="text-xs text-destructive">{t("bankSync.mapping.duplicate")}</p>
              )}
            </div>
            <label className={cn("block space-y-1.5", skipped && "opacity-50")}>
              <span className="block text-xs font-medium text-muted-foreground">{t("bankSync.mapping.syncFrom")}</span>
              <Input
                type="date"
                value={c.syncFrom}
                max={today}
                onChange={(e) => set(a.uid, { syncFrom: e.target.value })}
                disabled={busy || skipped}
              />
            </label>
          </div>
        );
      })}
      <div className="flex flex-col gap-3 bg-muted/40 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">{t("bankSync.mapping.footer")}</p>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {onCancel && (
            <Button variant="outline" onClick={onCancel} disabled={busy}>
              {t("common.cancel")}
            </Button>
          )}
          <Button onClick={save} disabled={busy || chosen.length === 0 || takenTwice.size > 0}>
            {busy && <Loader2 className="animate-spin" />}
            {t("bankSync.mapping.save")}
          </Button>
        </div>
      </div>
    </SettingsPanel>
  );
}
