"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { SettingsHeader, SettingsPanel } from "@/components/settings/settings-ui";
import { useI18n } from "@/lib/i18n/client";
import { useAccounts } from "@/hooks/use-accounts";
import { BANK_SYNC_KEY, useBankSyncStatus, type BankConnectionView } from "@/hooks/use-bank-sync";
import { useStepUp } from "@/hooks/use-step-up";
import { SetupPanel } from "./_components/setup-panel";
import { ConnectionsPanel } from "./_components/connections-panel";
import { ConnectDialog } from "./_components/connect-dialog";
import { MappingPanel } from "./_components/mapping-panel";

/**
 * Bank connections: the user's own Enable Banking application (step one) and
 * the banks it connects (step two). Every action that changes who can read
 * the user's bank asks for a fresh second factor first (useStepUp).
 */
export default function BankConnectionsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data: status, isLoading } = useBankSyncStatus();
  const { data: accounts = [] } = useAccounts();
  const stepUp = useStepUp();
  const [connectOpen, setConnectOpen] = useState(false);
  const [reconnect, setReconnect] = useState<BankConnectionView | null>(null);
  // A connection whose unlinked accounts are being linked after its trip to the bank.
  const [linking, setLinking] = useState<string | null>(null);
  const linkingRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (linking) linkingRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [linking]);

  const linkedAccountIds = new Set(status?.connections.flatMap((c) => c.links.map((l) => l.accountId)));
  const hasUnlinked = (c: BankConnectionView) => c.accounts.some((a) => !a.linkedAccountId);
  // One panel per bank connected in a row, each keyed by its trip, so saving
  // one never hands its choices to the next.
  const pending = (status?.pendingMappings ?? []).flatMap((p) => {
    const connection = status?.connections.find((c) => c.id === p.connectionId);
    return connection && hasUnlinked(connection) ? [{ ...p, connection }] : [];
  });
  const mappingOpen = new Set(pending.map((p) => p.connectionId));
  const later = status?.connections.find((c) => c.id === linking && hasUnlinked(c) && !mappingOpen.has(c.id));

  const refresh = () => {
    qc.invalidateQueries({ queryKey: BANK_SYNC_KEY });
    qc.invalidateQueries({ queryKey: ["accounts"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
  };

  return (
    <div className="max-w-3xl space-y-6">
      <SettingsHeader title="bankSync.title" description="bankSync.description" />

      {status && !status.workerOnline && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {t("bankSync.workerOffline")}
        </div>
      )}

      {isLoading || !status ? (
        <SettingsPanel title="bankSync.setup.title" loading loadingRows={3}>
          {null}
        </SettingsPanel>
      ) : (
        <>
          {pending.map((p) => (
            <MappingPanel
              key={p.authStateId}
              connection={p.connection}
              authStateId={p.authStateId}
              accounts={accounts}
              linkedAccountIds={linkedAccountIds}
              run={stepUp.run}
              onDone={refresh}
            />
          ))}
          <SetupPanel status={status} run={stepUp.run} onChanged={refresh} />
          <ConnectionsPanel
            status={status}
            accounts={accounts}
            run={stepUp.run}
            onChanged={refresh}
            canLink={(c) => hasUnlinked(c) && !mappingOpen.has(c.id) && c.id !== later?.id}
            onLinkAccounts={(c) => setLinking(c.id)}
            onConnect={() => {
              setReconnect(null);
              setConnectOpen(true);
            }}
            onReconnect={(c) => {
              setReconnect(c);
              setConnectOpen(true);
            }}
          />
          {later && (
            <div ref={linkingRef} className="scroll-mt-4">
              <MappingPanel
                key={later.id}
                connection={later}
                accounts={accounts}
                linkedAccountIds={linkedAccountIds}
                run={stepUp.run}
                onDone={() => {
                  setLinking(null);
                  refresh();
                }}
                onCancel={() => setLinking(null)}
              />
            </div>
          )}
          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t("bankSync.securityNote")}
          </p>
        </>
      )}

      {connectOpen && (
        <ConnectDialog
          open={connectOpen}
          onOpenChange={setConnectOpen}
          run={stepUp.run}
          reconnect={
            reconnect
              ? { connectionId: reconnect.id, aspspName: reconnect.aspspName, aspspCountry: reconnect.aspspCountry }
              : null
          }
        />
      )}
      {stepUp.dialog}
    </div>
  );
}
