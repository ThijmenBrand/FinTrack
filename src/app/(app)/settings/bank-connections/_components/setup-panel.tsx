"use client";

import { useState } from "react";
import { Check, CheckCircle2, Copy, Download, ExternalLink, KeyRound, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { SettingsPanel, SettingsRow } from "@/components/settings/settings-ui";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import { bankErrorText, useNow, waitForRequest, type BankSyncStatus } from "@/hooks/use-bank-sync";
import { StepUpCancelled } from "@/hooks/use-step-up";

const ENABLE_BANKING_CONTROL_PANEL = "https://enablebanking.com/cp/applications";
const CERTIFICATE_WARNING_MS = 30 * 86_400_000;

type Run = <T>(fn: () => Promise<T>) => Promise<T>;

function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={label}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? t("bankSync.copied") : t("bankSync.copy")}
    </Button>
  );
}

/**
 * Step one: the user's own Enable Banking application. FinTrack generates the
 * key and certificate; the user registers the certificate and our redirect URL
 * in Enable Banking and pastes the application id back.
 */
export function SetupPanel({
  status,
  run,
  onChanged,
}: {
  status: BankSyncStatus;
  run: Run;
  onChanged: () => void;
}) {
  const { t, formatDate } = useI18n();
  const credential = status.credential;
  const [appId, setAppId] = useState(credential?.appId ?? "");
  const [busy, setBusy] = useState<null | "generate" | "appId" | "verify" | "delete">(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();
  const pending = !!status.pendingCredentialJob || credential?.status === "verifying";

  async function act(kind: NonNullable<typeof busy>, fn: () => Promise<{ requestId: string }>) {
    setBusy(kind);
    setError(null);
    try {
      const { requestId } = await run(fn);
      onChanged();
      const outcome = await waitForRequest(requestId, 120_000);
      if (!outcome.ok) setError(bankErrorText(t, outcome.errorCode));
    } catch (e) {
      if (!(e instanceof StepUpCancelled)) setError(e instanceof Error ? e.message : t("common.somethingWentWrong"));
    } finally {
      setBusy(null);
      onChanged();
    }
  }

  const generate = () =>
    act("generate", () => apiFetch<{ requestId: string }>("/api/bank-sync/credentials", { method: "POST" }));
  const saveAppId = (e: React.FormEvent) => {
    e.preventDefault();
    return act("appId", () =>
      apiFetch<{ requestId: string }>("/api/bank-sync/credentials", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: appId.trim() }),
      }),
    );
  };
  const verifyAgain = () =>
    act("verify", () => apiFetch<{ requestId: string }>("/api/bank-sync/credentials/verify", { method: "POST" }));
  const remove = () =>
    act("delete", () => apiFetch<{ requestId: string }>("/api/bank-sync/credentials", { method: "DELETE" }));

  if (!credential) {
    return (
      <SettingsPanel title="bankSync.setup.title" icon={KeyRound}>
        <SettingsRow
          label={t("bankSync.setup.startLabel")}
          hint={t("bankSync.setup.startHint")}
          control={
            <Button onClick={generate} disabled={!!busy || pending}>
              {(busy === "generate" || pending) && <Loader2 className="animate-spin" />}
              {busy === "generate" || pending ? t("bankSync.setup.generating") : t("bankSync.setup.generate")}
            </Button>
          }
        />
        {error && <p role="alert" className="px-5 pb-4 text-sm text-destructive">{error}</p>}
      </SettingsPanel>
    );
  }

  const certificateExpiresSoon = Date.parse(credential.notAfter) - now < CERTIFICATE_WARNING_MS;
  const downloadHref = `data:application/x-pem-file;charset=utf-8,${encodeURIComponent(credential.certificatePem)}`;

  if (credential.status === "verified") {
    return (
      <SettingsPanel
        title="bankSync.setup.title"
        icon={KeyRound}
        action={
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t("bankSync.setup.verified")}
          </span>
        }
      >
        <SettingsRow
          label={t("bankSync.setup.appIdLabel")}
          hint={<span className="font-mono">{credential.appId}</span>}
          control={
            <Button variant="outline" size="sm" onClick={verifyAgain} disabled={!!busy || pending}>
              {busy === "verify" || pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {t("bankSync.setup.checkAgain")}
            </Button>
          }
        />
        <SettingsRow
          label={t("bankSync.setup.certificateLabel")}
          hint={
            <>
              <span className="font-mono break-all">{credential.fingerprint}</span>
              <br />
              <span className={certificateExpiresSoon ? "font-medium text-amber-600 dark:text-amber-400" : undefined}>
                {t("bankSync.setup.certificateValidUntil", { date: formatDate(credential.notAfter) })}
              </span>
            </>
          }
        />
        <SettingsRow
          label={t("bankSync.setup.deleteLabel")}
          hint={t("bankSync.setup.deleteHint")}
          control={
            <ConfirmDeleteButton
              variant="text"
              label={t("bankSync.setup.delete")}
              confirmLabel={t("bankSync.setup.deleteConfirm")}
              message={t("bankSync.setup.deleteMessage")}
              pending={busy === "delete"}
              onConfirm={remove}
            />
          }
        />
        {error && <p role="alert" className="px-5 pb-4 text-sm text-destructive">{error}</p>}
      </SettingsPanel>
    );
  }

  return (
    <SettingsPanel title="bankSync.setup.title" icon={KeyRound}>
      <ol className="divide-y">
        <li>
          <SettingsRow
            label={t("bankSync.setup.step1")}
            hint={t("bankSync.setup.step1Hint")}
            control={
              <Button asChild variant="outline" size="sm">
                <a href={ENABLE_BANKING_CONTROL_PANEL} target="_blank" rel="noopener noreferrer">
                  <ExternalLink />
                  {t("bankSync.setup.openControlPanel")}
                </a>
              </Button>
            }
          />
        </li>
        <li>
          <SettingsRow
            label={t("bankSync.setup.step2")}
            hint={<span className="break-all font-mono text-foreground">{status.redirectUrl}</span>}
            control={<CopyButton value={status.redirectUrl} label={t("bankSync.setup.copyRedirect")} />}
          />
        </li>
        <li>
          <SettingsRow label={t("bankSync.setup.step3")} hint={t("bankSync.setup.step3Hint")}>
            <textarea
              readOnly
              value={credential.certificatePem}
              aria-label={t("bankSync.setup.certificateLabel")}
              className="mt-2 h-28 w-full resize-none rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-snug"
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <CopyButton value={credential.certificatePem} label={t("bankSync.setup.copyCertificate")} />
              <Button asChild variant="outline" size="sm">
                <a href={downloadHref} download="fintrack.crt">
                  <Download />
                  {t("bankSync.setup.download")}
                </a>
              </Button>
              <span className="text-[11px] text-muted-foreground">
                SHA-256 <span className="font-mono break-all">{credential.fingerprint}</span>
              </span>
            </div>
          </SettingsRow>
        </li>
        <li>
          <SettingsRow label={t("bankSync.setup.step4")} hint={t("bankSync.setup.step4Hint")} />
        </li>
        <li>
          <SettingsRow label={t("bankSync.setup.step5")} hint={t("bankSync.setup.step5Hint")} htmlFor="eb-app-id">
            <form className="mt-2 flex flex-col gap-2 sm:flex-row" onSubmit={saveAppId}>
              <Input
                id="eb-app-id"
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="font-mono sm:max-w-sm"
                autoComplete="off"
                spellCheck={false}
                required
              />
              <Button type="submit" disabled={!!busy || pending || !appId.trim()}>
                {(busy === "appId" || pending) && <Loader2 className="animate-spin" />}
                {pending ? t("bankSync.setup.verifying") : t("bankSync.setup.saveAndVerify")}
              </Button>
            </form>
            {credential.status === "invalid" && credential.lastErrorCode && !pending && (
              <p className="mt-2 flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {bankErrorText(t, credential.lastErrorCode)}{" "}
                  <button type="button" className="font-medium underline-offset-4 hover:underline" onClick={verifyAgain}>
                    {t("bankSync.setup.checkAgain")}
                  </button>
                </span>
              </p>
            )}
          </SettingsRow>
        </li>
      </ol>
      <SettingsRow
        label={t("bankSync.setup.startOverLabel")}
        hint={t("bankSync.setup.startOverHint")}
        control={
          <ConfirmDeleteButton
            variant="text"
            label={t("bankSync.setup.startOver")}
            confirmLabel={t("bankSync.setup.deleteConfirm")}
            message={t("bankSync.setup.startOverMessage")}
            pending={busy === "delete"}
            onConfirm={remove}
          />
        }
      />
      {error && <p role="alert" className="px-5 pb-4 text-sm text-destructive">{error}</p>}
    </SettingsPanel>
  );
}
