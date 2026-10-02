"use client";

import { useState } from "react";
import { Landmark, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsPanel } from "@/components/settings/settings-ui";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import type { Account } from "@/types/api";
import type { BankSyncStatus } from "@/hooks/use-bank-sync";

type Mapping = NonNullable<BankSyncStatus["pendingMapping"]>;

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
 */
export function MappingPanel({
  mapping,
  accounts,
  onDone,
}: {
  mapping: Mapping;
  accounts: Account[];
  onDone: () => void;
}) {
  const { t } = useI18n();
  const own = accounts.filter((a) => a.role === "owner");
  const today = new Date().toISOString().slice(0, 10);
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(
      mapping.accounts.map((a) => [
        a.uid,
        {
          target: a.linkedAccountId ? SKIP : a.suggestedAccountId ?? NEW,
          name: a.name || mapping.aspspName,
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
    try {
      await apiFetch("/api/bank-sync/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authStateId: mapping.authStateId,
          links: chosen.map(([uid, c]) => ({
            uid,
            syncFrom: c.syncFrom,
            ...(c.target === NEW ? { newAccount: { name: c.name, type: "checking" } } : { accountId: c.target }),
          })),
        }),
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.somethingWentWrong"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsPanel
      title="bankSync.mapping.title"
      description="bankSync.mapping.description"
      icon={Landmark}
      footer={t("bankSync.mapping.footer")}
    >
      {mapping.accounts.map((a) => {
        const c = choices[a.uid];
        return (
          <div key={a.uid} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_14rem_10rem] sm:items-start">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{a.name || mapping.aspspName}</p>
              {a.iban && <p className="truncate font-mono text-[11px] text-muted-foreground">{a.iban}</p>}
              {a.linkedAccountId && (
                <p className="text-xs text-muted-foreground">{t("bankSync.mapping.alreadyLinked")}</p>
              )}
            </div>
            <div className="space-y-2">
              <Select value={c.target} onValueChange={(v) => set(a.uid, { target: v })} disabled={busy}>
                <SelectTrigger aria-label={t("bankSync.mapping.target", { name: a.name || a.uid })}>
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
                  maxLength={100}
                  disabled={busy}
                />
              )}
              {takenTwice.has(c.target) && (
                <p className="text-xs text-destructive">{t("bankSync.mapping.duplicate")}</p>
              )}
            </div>
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>{t("bankSync.mapping.syncFrom")}</span>
              <Input
                type="date"
                value={c.syncFrom}
                max={today}
                onChange={(e) => set(a.uid, { syncFrom: e.target.value })}
                disabled={busy || c.target === SKIP}
              />
            </label>
          </div>
        );
      })}
      <div className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
        {error && (
          <p role="alert" className="text-sm text-destructive sm:mr-auto">
            {error}
          </p>
        )}
        <Button onClick={save} disabled={busy || chosen.length === 0 || takenTwice.size > 0}>
          {busy && <Loader2 className="animate-spin" />}
          {t("bankSync.mapping.save")}
        </Button>
      </div>
    </SettingsPanel>
  );
}
