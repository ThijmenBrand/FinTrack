"use client";

import { useState } from "react";
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
          {status.pendingMapping && (
            <MappingPanel mapping={status.pendingMapping} accounts={accounts} onDone={refresh} />
          )}
          <SetupPanel status={status} run={stepUp.run} onChanged={refresh} />
          <ConnectionsPanel
            status={status}
            accounts={accounts}
            run={stepUp.run}
            onChanged={refresh}
            onConnect={() => {
              setReconnect(null);
              setConnectOpen(true);
            }}
            onReconnect={(c) => {
              setReconnect(c);
              setConnectOpen(true);
            }}
          />
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
