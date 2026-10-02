"use client";

import { useState } from "react";
import {
  Check,
  Landmark,
  Link2,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCw,
  TriangleAlert,
  Unlink,
  Unplug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SettingsPanel } from "@/components/settings/settings-ui";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import { MONEY_EPSILON } from "@/lib/validation";
import type { Account } from "@/types/api";
import {
  bankErrorText,
  syncedAgo,
  useNow,
  waitForRequest,
  type BankConnectionView,
  type BankLinkView,
  type BankSyncStatus,
} from "@/hooks/use-bank-sync";
import { StepUpCancelled } from "@/hooks/use-step-up";
import { cn } from "@/lib/utils";
import { BankMark, maskedIban } from "./bank-mark";

const CONSENT_WARNING_MS = 14 * 86_400_000;

type Run = <T>(fn: () => Promise<T>) => Promise<T>;

/** Whether the consent needs the user: lapsed, broken, or ending within two weeks. */
function needsReconnect(connection: BankConnectionView, now: number): boolean {
  if (connection.disconnecting) return false;
  if (connection.status !== "active") return true;
  return !!connection.validUntil && Date.parse(connection.validUntil) - now < CONSENT_WARNING_MS;
}

function ConsentLine({ connection }: { connection: BankConnectionView }) {
  const { t, formatDate } = useI18n();
  const now = useNow();
  if (connection.disconnecting) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t("bankSync.connections.disconnecting")}
      </span>
    );
  }
  if (connection.status !== "active") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
        <TriangleAlert className="h-3 w-3" />
        {t(`bankSync.connections.status.${connection.status}`)}
      </span>
    );
  }
  const endsSoon = needsReconnect(connection, now);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        endsSoon ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn("h-1.5 w-1.5 rounded-full", endsSoon ? "bg-amber-500" : "bg-emerald-500")}
      />
      {connection.validUntil
        ? t("bankSync.connections.consentUntil", { date: formatDate(connection.validUntil) })
        : t("bankSync.connections.status.active")}
    </span>
  );
}

function LinkRow({
  link,
  account,
  connectionActive,
  run,
  onChanged,
}: {
  link: BankLinkView;
  account: Account | undefined;
  connectionActive: boolean;
  run: Run;
  onChanged: () => void;
}) {
  const i18n = useI18n();
  const { t, formatCurrency } = i18n;
  const [busy, setBusy] = useState<null | "sync" | "align" | "unlink">(null);
  const [error, setError] = useState<string | null>(null);
  const currency = account?.currency ?? "EUR";
  const mismatch =
    link.bankBalance !== null && Math.abs(link.bankBalance - link.fintrackBalance) > MONEY_EPSILON;

  async function syncNow() {
    setBusy("sync");
    setError(null);
    try {
      const { requestId } = await apiFetch<{ requestId: string }>(`/api/bank-sync/links/${link.id}/sync`, {
        method: "POST",
      });
      onChanged();
      const outcome = await waitForRequest(requestId, 120_000);
      if (!outcome.ok) setError(bankErrorText(t, outcome.errorCode));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.somethingWentWrong"));
    } finally {
      setBusy(null);
      onChanged();
    }
  }

  // Shift the opening balance by the difference, so FinTrack's balance equals
  // the bank's. The transactions themselves are not touched.
  async function align() {
    if (!account || link.bankBalance === null) return;
    setBusy("align");
    setError(null);
    try {
      const diff = Math.round((link.bankBalance - link.fintrackBalance) * 100) / 100;
      await apiFetch("/api/accounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: account.id, initialBalance: Math.round((account.initialBalance + diff) * 100) / 100 }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.somethingWentWrong"));
    } finally {
      setBusy(null);
      onChanged();
    }
  }

  async function unlink() {
    setBusy("unlink");
    setError(null);
    try {
      await run(() => apiFetch(`/api/bank-sync/links/${link.id}`, { method: "DELETE" }));
    } catch (e) {
      if (!(e instanceof StepUpCancelled)) setError(e instanceof Error ? e.message : t("common.somethingWentWrong"));
    } finally {
      setBusy(null);
      onChanged();
    }
  }

  const syncing = link.syncing || busy === "sync";
  const iban = maskedIban(link.iban);

  return (
    <div className="space-y-1.5 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="truncate text-sm font-medium">{link.accountName}</p>
          {/* The dot belongs to the item after it, so a wrapped line never ends on one. */}
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground [&>span+span]:before:mr-1.5 [&>span+span]:before:content-['·']">
            {iban && <span className="tabular-nums">{iban}</span>}
            {syncing ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("bankSync.connections.syncing")}
              </span>
            ) : (
              <span>{t("bankSync.connections.lastSynced", { when: syncedAgo(i18n, link.lastSyncedAt) })}</span>
            )}
            <span>{t("bankSync.connections.since", { date: i18n.formatDate(link.syncFrom) })}</span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums">{formatCurrency(link.fintrackBalance, currency)}</p>
          {link.bankBalance !== null && !mismatch && (
            <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
              {t("bankSync.connections.balanceMatches")}
            </p>
          )}
        </div>
        <div className="-mr-1.5 flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={syncNow}
            disabled={!connectionActive || !!busy || link.syncing}
            aria-label={t("bankSync.connections.syncNow")}
            title={t("bankSync.connections.syncNow")}
          >
            <RefreshCw className={cn(syncing && "animate-spin")} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                disabled={!!busy}
                aria-label={t("bankSync.connections.actions", { name: link.accountName })}
              >
                {busy === "unlink" ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={unlink} className="text-destructive focus:text-destructive">
                <Unlink />
                {t("bankSync.connections.stopSyncing")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {mismatch && link.bankBalance !== null && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-800 dark:text-amber-300">
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <TriangleAlert className="h-3 w-3 shrink-0" />
            {t("bankSync.connections.balanceCheck", {
              bank: formatCurrency(link.bankBalance, currency),
              fintrack: formatCurrency(link.fintrackBalance, currency),
            })}
          </span>
          {account && (
            <button
              type="button"
              className="ml-auto font-medium underline underline-offset-4 hover:no-underline disabled:opacity-50"
              onClick={align}
              disabled={!!busy}
            >
              {t("bankSync.connections.align")}
            </button>
          )}
        </div>
      )}
      {link.lastErrorCode && !syncing && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
          {bankErrorText(t, link.lastErrorCode)}
        </p>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Step two: the banks this user connected, and the accounts each one feeds. */
export function ConnectionsPanel({
  status,
  accounts,
  run,
  onChanged,
  onConnect,
  onReconnect,
  canLink,
  onLinkAccounts,
}: {
  status: BankSyncStatus;
  accounts: Account[];
  run: Run;
  onChanged: () => void;
  onConnect: () => void;
  onReconnect: (c: BankConnectionView) => void;
  /** Has bank accounts not linked yet, and no mapping open for them. */
  canLink: (c: BankConnectionView) => boolean;
  onLinkAccounts: (c: BankConnectionView) => void;
}) {
  const { t } = useI18n();
  const now = useNow();
  const verified = status.credential?.status === "verified";
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  async function disconnect(connection: BankConnectionView) {
    setDisconnecting(connection.id);
    setError(null);
    try {
      const { requestId } = await run(() =>
        apiFetch<{ requestId: string }>(`/api/bank-sync/connections/${connection.id}`, { method: "DELETE" }),
      );
      setConfirming(null);
      onChanged();
      const outcome = await waitForRequest(requestId);
      if (!outcome.ok) setError(bankErrorText(t, outcome.errorCode));
    } catch (e) {
      if (!(e instanceof StepUpCancelled)) setError(e instanceof Error ? e.message : t("common.somethingWentWrong"));
    } finally {
      setDisconnecting(null);
      onChanged();
    }
  }

  return (
    <SettingsPanel
      title="bankSync.connections.title"
      icon={Landmark}
      action={
        <Button size="sm" onClick={onConnect} disabled={!verified}>
          <Plus />
          {t("bankSync.connections.connect")}
        </Button>
      }
    >
      {!verified && (
        <p className="px-5 py-4 text-sm text-muted-foreground">{t("bankSync.connections.finishSetupFirst")}</p>
      )}
      {verified && status.connections.length === 0 && (
        <p className="px-5 py-4 text-sm text-muted-foreground">{t("bankSync.connections.empty")}</p>
      )}
      {status.connections.map((c) => {
        const active = c.status === "active" && !c.disconnecting;
        const reconnectFirst = verified && needsReconnect(c, now);
        const showLink = canLink(c) && active;
        return (
          <div key={c.id} className="space-y-3 px-5 py-4">
            <div className="flex items-center gap-3">
              <BankMark name={c.aspspName} />
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="truncate text-sm font-semibold leading-tight">
                  {c.aspspName}
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">{c.aspspCountry}</span>
                </p>
                <ConsentLine connection={c} />
              </div>
              {reconnectFirst && (
                <Button variant="outline" size="sm" onClick={() => onReconnect(c)}>
                  <RotateCw />
                  {t("bankSync.connections.reconnect")}
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-mr-1.5 h-8 w-8 shrink-0 text-muted-foreground"
                    disabled={c.disconnecting || disconnecting === c.id}
                    aria-label={t("bankSync.connections.actions", { name: c.aspspName })}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => onReconnect(c)} disabled={!verified}>
                    <RotateCw />
                    {t("bankSync.connections.reconnect")}
                  </DropdownMenuItem>
                  {showLink && (
                    <DropdownMenuItem onClick={() => onLinkAccounts(c)} disabled={!verified}>
                      <Link2 />
                      {t("bankSync.connections.linkAccounts")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setConfirming(c.id)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Unplug />
                    {t("bankSync.connections.disconnect")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {c.lastErrorCode && c.status !== "active" && (
              <p className="text-xs text-muted-foreground sm:pl-11">{bankErrorText(t, c.lastErrorCode)}</p>
            )}

            {confirming === c.id && (
              <div className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-3 sm:ml-11 sm:flex-row sm:items-center sm:justify-between dark:border-red-900/40 dark:bg-red-950/30">
                <p className="text-sm">{t("bankSync.connections.disconnectMessage")}</p>
                <div className="flex shrink-0 justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirming(null)}
                    disabled={disconnecting === c.id}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => disconnect(c)} disabled={disconnecting === c.id}>
                    {disconnecting === c.id && <Loader2 className="animate-spin" />}
                    {t("bankSync.connections.disconnectConfirm")}
                  </Button>
                </div>
              </div>
            )}

            {(c.links.length > 0 || showLink) && (
              <div className="divide-y overflow-hidden rounded-lg border sm:ml-11">
                {c.links.map((l) => (
                  <LinkRow
                    key={l.id}
                    link={l}
                    account={accounts.find((a) => a.id === l.accountId)}
                    connectionActive={active}
                    run={run}
                    onChanged={onChanged}
                  />
                ))}
                {showLink && (
                  <div className="flex flex-col gap-2 bg-muted/40 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-muted-foreground">{t("bankSync.connections.notLinked")}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="self-start sm:self-auto"
                      onClick={() => onLinkAccounts(c)}
                      disabled={!verified}
                    >
                      <Link2 />
                      {t("bankSync.connections.linkAccounts")}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {error && <p role="alert" className="px-5 pb-4 text-sm text-destructive">{error}</p>}
    </SettingsPanel>
  );
}
