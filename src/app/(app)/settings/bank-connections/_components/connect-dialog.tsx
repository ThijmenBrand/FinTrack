"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import { BANK_SYNC_COUNTRIES } from "@/lib/bank-sync/config";
import { bankErrorText, waitForRequest } from "@/hooks/use-bank-sync";
import { StepUpCancelled } from "@/hooks/use-step-up";
import { cn } from "@/lib/utils";

interface Aspsp {
  name: string;
  country: string;
  maxConsentDays: number | null;
}

type Run = <T>(fn: () => Promise<T>) => Promise<T>;

/** Send the browser to the bank. Only ever an https URL the worker validated. */
function goToBank(url: string) {
  if (!/^https:\/\//i.test(url)) throw new Error("Refusing a non-https bank URL");
  window.location.assign(url);
}

/**
 * Pick a bank and go there to give consent. Also used for "Reconnect" (bank
 * fixed, `connectionId` set). Confirming asks for step-up; the bank's URL
 * comes back from the worker, which minted the one-time state for this trip.
 */
export function ConnectDialog({
  open,
  onOpenChange,
  run,
  reconnect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: Run;
  reconnect?: { connectionId: string; aspspName: string; aspspCountry: string } | null;
}) {
  const { t } = useI18n();
  const [country, setCountry] = useState(reconnect?.aspspCountry ?? "NL");
  // Fetched lists per country; a country without an entry is still loading.
  const [lists, setLists] = useState<Record<string, Aspsp[]>>({});
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(reconnect?.aspspName ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aspsps = lists[country] ?? null;
  const loadingList = !reconnect && !aspsps && !error;

  // The page mounts this dialog only while it is open, so every open starts
  // clean; only switching country fetches again.
  useEffect(() => {
    if (reconnect || lists[country]) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{ aspsps?: Aspsp[]; requestId?: string }>(
          `/api/bank-sync/aspsps?country=${encodeURIComponent(country)}`,
        );
        let list = res.aspsps;
        if (!list && res.requestId) {
          const outcome = await waitForRequest<{ aspsps: Aspsp[] }>(res.requestId);
          if (!outcome.ok) throw new Error(bankErrorText(t, outcome.errorCode));
          list = outcome.result?.aspsps ?? [];
        }
        if (!cancelled) setLists((l) => ({ ...l, [country]: list ?? [] }));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("common.somethingWentWrong"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [country, reconnect, lists, t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (aspsps ?? []).filter((a) => !q || a.name.toLowerCase().includes(q));
  }, [aspsps, query]);

  async function connect() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const { requestId } = await run(() =>
        apiFetch<{ requestId: string }>("/api/bank-sync/connections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            aspspName: selected,
            aspspCountry: reconnect?.aspspCountry ?? country,
            ...(reconnect ? { connectionId: reconnect.connectionId } : {}),
          }),
        }),
      );
      const outcome = await waitForRequest<{ url: string }>(requestId);
      if (!outcome.ok || !outcome.result?.url) throw new Error(bankErrorText(t, outcome.errorCode));
      goToBank(outcome.result.url);
    } catch (e) {
      if (!(e instanceof StepUpCancelled)) setError(e instanceof Error ? e.message : t("common.somethingWentWrong"));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {reconnect ? t("bankSync.connect.reconnectTitle", { bank: reconnect.aspspName }) : t("bankSync.connect.title")}
          </DialogTitle>
          <DialogDescription>
            {reconnect ? t("bankSync.connect.reconnectDescription") : t("bankSync.connect.description")}
          </DialogDescription>
        </DialogHeader>

        {!reconnect && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Select
                value={country}
                onValueChange={(c) => {
                  setCountry(c);
                  setSelected(null);
                  setError(null);
                }}
                disabled={busy}
              >
                <SelectTrigger className="w-28" aria-label={t("bankSync.connect.country")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BANK_SYNC_COUNTRIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("bankSync.connect.search")}
                  aria-label={t("bankSync.connect.search")}
                  className="pl-8"
                  disabled={busy}
                />
              </div>
            </div>
            <div
              role="listbox"
              aria-label={t("bankSync.connect.banks")}
              className="max-h-72 overflow-y-auto rounded-md border"
            >
              {loadingList && (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {!loadingList && aspsps && filtered.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("bankSync.connect.noBanks")}</p>
              )}
              {filtered.map((a) => (
                <button
                  key={a.name}
                  type="button"
                  role="option"
                  aria-selected={selected === a.name}
                  onClick={() => setSelected(a.name)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 border-b px-3 py-2.5 text-left text-sm last:border-b-0",
                    "hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                    selected === a.name && "bg-primary/10 font-medium text-primary",
                  )}
                >
                  <span className="truncate">{a.name}</span>
                  {a.maxConsentDays && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t("bankSync.connect.consentDays", { days: Math.min(a.maxConsentDays, 180) })}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">{t("bankSync.connect.privacy")}</p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={connect} disabled={!selected || busy}>
            {busy && <Loader2 className="animate-spin" />}
            {busy ? t("bankSync.connect.redirecting") : t("bankSync.connect.continue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
