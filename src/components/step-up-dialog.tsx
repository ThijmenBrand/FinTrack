"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Fingerprint, Loader2, ShieldCheck } from "lucide-react";
import { startAuthentication } from "@simplewebauthn/browser";
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
import { apiFetch, ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";

interface StepUpStatus {
  methods: { totp: boolean; passkey: boolean };
  activeUntil: string | null;
}

/**
 * "Confirm it's you": a fresh second factor before a sensitive action. A
 * passkey (one tap) when the user has one, otherwise their authenticator code
 * or a backup code. The password alone is never enough here.
 */
export function StepUpDialog({
  open,
  onConfirmed,
  onCancel,
}: {
  open: boolean;
  onConfirmed: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<StepUpStatus | null>(null);
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mounted fresh for every prompt (useStepUp keys it), so there is no state
  // from a previous prompt to reset here.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiFetch<StepUpStatus>("/api/step-up")
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        if (!cancelled) setError(t("common.somethingWentWrong"));
      });
    return () => {
      cancelled = true;
    };
  }, [open, t]);

  const fail = (e: unknown) =>
    setError(e instanceof ApiError || e instanceof Error ? e.message : t("common.somethingWentWrong"));

  async function withPasskey() {
    setBusy(true);
    setError(null);
    try {
      const optionsJSON = await apiFetch<Parameters<typeof startAuthentication>[0]["optionsJSON"]>(
        "/api/step-up/passkey/options",
        { method: "POST" },
      );
      const response = await startAuthentication({ optionsJSON });
      await apiFetch("/api/step-up/passkey/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      onConfirmed();
    } catch (e) {
      // The browser's own "cancelled" isn't an error worth shouting about.
      if (e instanceof Error && e.name === "NotAllowedError") setError(t("stepUp.passkeyCancelled"));
      else fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function withCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/step-up/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, kind: mode }),
      });
      onConfirmed();
    } catch (err) {
      fail(err);
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  const none = status && !status.methods.totp && !status.methods.passkey;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
            {t("stepUp.title")}
          </DialogTitle>
          <DialogDescription>{t("stepUp.description")}</DialogDescription>
        </DialogHeader>

        {!status && !error && (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label={t("stepUp.loading")} />
          </div>
        )}

        {none && (
          <p className="text-sm text-muted-foreground">
            {t("stepUp.noMethods")}{" "}
            <Link href="/profile" className="font-medium text-primary underline-offset-4 hover:underline">
              {t("stepUp.openProfile")}
            </Link>
          </p>
        )}

        {status?.methods.passkey && (
          <Button type="button" className="w-full" onClick={withPasskey} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
            {t("stepUp.usePasskey")}
          </Button>
        )}

        {status?.methods.totp && (
          <form className="space-y-3" onSubmit={withCode}>
            {status.methods.passkey && (
              <p className="text-center text-xs text-muted-foreground">{t("stepUp.or")}</p>
            )}
            <Input
              aria-label={mode === "totp" ? t("stepUp.codeLabel") : t("stepUp.backupLabel")}
              placeholder={mode === "totp" ? "123456" : t("stepUp.backupPlaceholder")}
              inputMode={mode === "totp" ? "numeric" : "text"}
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={mode === "totp" ? 7 : 64}
              autoFocus={!status.methods.passkey}
              className="font-mono tracking-widest"
              required
            />
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => {
                  setMode(mode === "totp" ? "backup" : "totp");
                  setCode("");
                  setError(null);
                }}
              >
                {mode === "totp" ? t("stepUp.useBackup") : t("stepUp.useCode")}
              </button>
              <Button type="submit" variant={status.methods.passkey ? "outline" : "default"} disabled={busy || !code}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("stepUp.confirm")}
              </Button>
            </div>
          </form>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
