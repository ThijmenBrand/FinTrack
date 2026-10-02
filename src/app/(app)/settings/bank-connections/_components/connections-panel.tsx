"use client";

import { useState } from "react";
import { Landmark, Loader2, Plus, RefreshCw, TriangleAlert, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
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

const CONSENT_WARNING_MS = 14 * 86_400_000;

type Run = <T>(fn: () => Promise<T>) => Promise<T>;

function StatusPill({ connection }: { connection: BankConnectionView }) {
  const { t, formatDate } = useI18n();
  const now = useNow();
  if (connection.disconnecting) {
    return <span className="text-xs text-muted-foreground">{t("bankSync.connections.disconnecting")}</span>;
  }
  if (connection.status !== "active") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
        <TriangleAlert className="h-3 w-3" />
        {t(`bankSync.connections.status.${connection.status}`)}
      </span>
    );
  }
  const endsSoon = connection.validUntil && Date.parse(connection.validUntil) - now < CONSENT_WARNING_MS;
  return (
    <span className={cn("text-xs", endsSoon ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
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

  return (
    <div className="flex flex-col gap-2 px-5 py-3 pl-12 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-0.5">
        <p className="truncate text-sm font-medium">{link.accountName}</p>
        <p className="text-xs text-muted-foreground">
          {syncing
            ? t("bankSync.connections.syncing")
            : t("bankSync.connections.lastSynced", { when: syncedAgo(i18n, link.lastSyncedAt) })}
          {" · "}
          {t("bankSync.connections.since", { date: i18n.formatDate(link.syncFrom) })}
        </p>
        {link.lastErrorCode && !syncing && (
          <p className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
            {bankErrorText(t, link.lastErrorCode)}
          </p>
        )}
        {link.bankBalance !== null && (
          <p className={cn("text-xs tabular-nums", mismatch ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
            {t("bankSync.connections.balanceCheck", {
              bank: formatCurrency(link.bankBalance, currency),
              fintrack: formatCurrency(link.fintrackBalance, currency),
            })}
            {mismatch && account && (
              <>
                {" "}
                <button
                  type="button"
                  className="font-medium underline-offset-4 hover:underline"
                  onClick={align}
                  disabled={!!busy}
                >
                  {t("bankSync.connections.align")}
                </button>
              </>
            )}
          </p>
        )}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button variant="outline" size="sm" onClick={syncNow} disabled={!connectionActive || !!busy || link.syncing}>
          {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {t("bankSync.connections.syncNow")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={unlink}
          disabled={!!busy}
          aria-label={t("bankSync.connections.unlink", { name: link.accountName })}
          title={t("bankSync.connections.unlink", { name: link.accountName })}
        >
          {busy === "unlink" ? <Loader2 className="animate-spin" /> : <Unlink />}
        </Button>
      </div>
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
}: {
  status: BankSyncStatus;
  accounts: Account[];
  run: Run;
  onChanged: () => void;
  onConnect: () => void;
  onReconnect: (c: BankConnectionView) => void;
}) {
  const { t } = useI18n();
  const verified = status.credential?.status === "verified";
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  async function disconnect(connection: BankConnectionView) {
    setDisconnecting(connection.id);
    setError(null);
    try {
      const { requestId } = await run(() =>
        apiFetch<{ requestId: string }>(`/api/bank-sync/connections/${connection.id}`, { method: "DELETE" }),
      );
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
      {status.connections.map((c) => (
        <div key={c.id}>
          <div className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Landmark className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{c.aspspName}</p>
                <StatusPill connection={c} />
                {c.lastErrorCode && c.status !== "active" && (
                  <p className="text-xs text-muted-foreground">{bankErrorText(t, c.lastErrorCode)}</p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={() => onReconnect(c)} disabled={!verified || c.disconnecting}>
                {t("bankSync.connections.reconnect")}
              </Button>
              <ConfirmDeleteButton
                variant="text"
                label={t("bankSync.connections.disconnect")}
                confirmLabel={t("bankSync.connections.disconnectConfirm")}
                message={t("bankSync.connections.disconnectMessage")}
                pending={disconnecting === c.id || c.disconnecting}
                onConfirm={() => disconnect(c)}
              />
            </div>
          </div>
          {c.links.map((l) => (
            <LinkRow
              key={l.id}
              link={l}
              account={accounts.find((a) => a.id === l.accountId)}
              connectionActive={c.status === "active" && !c.disconnecting}
              run={run}
              onChanged={onChanged}
            />
          ))}
        </div>
      ))}
      {error && <p role="alert" className="px-5 pb-4 text-sm text-destructive">{error}</p>}
    </SettingsPanel>
  );
}
