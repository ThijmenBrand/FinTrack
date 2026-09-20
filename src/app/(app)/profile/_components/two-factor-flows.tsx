"use client";

import { useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { Copy, Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useI18n } from "@/lib/i18n/client";
import { FormMessage, type FormMessageState } from "./form-message";

/**
 * The two enrolment flows, separated from where they are shown. The profile
 * page opens them in a dialog; the backoffice puts the setup flow on a page of
 * its own and won't let you past it. Same steps either way.
 */

type Enrollment = { uri: string; backupCodes: string[]; qrCode: string };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/** Password → QR + recovery codes → 6-digit verification. */
export function TwoFactorSetup({
  onEnabled,
  onCancel,
  redirectTo,
}: {
  onEnabled?: () => void;
  /** Omit to hide the cancel button — the backoffice enrolment is mandatory. */
  onCancel?: () => void;
  redirectTo?: string;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [backupCodesSaved, setBackupCodesSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<FormMessageState>(null);

  async function beginSetup(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLoading(true);
    try {
      const result = await authClient.twoFactor.enable({ password });
      // Without an explicit `method` the server enrols TOTP; the "otp" arm of
      // the response union carries no URI to build a QR code from.
      if (result.error || result.data?.method !== "totp") {
        setMessage({
          type: "error",
          text: result.error?.message || t("profile.twoFactor.startFailed"),
        });
        return;
      }
      const qrCode = await QRCode.toDataURL(result.data.totpURI, {
        width: 224,
        margin: 1,
      });
      setEnrollment({
        uri: result.data.totpURI,
        backupCodes: result.data.backupCodes,
        qrCode,
      });
      setPassword("");
    } catch (error) {
      setMessage({
        type: "error",
        text: errorMessage(error, t("profile.twoFactor.startFailed")),
      });
    } finally {
      setLoading(false);
    }
  }

  async function verifySetup(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLoading(true);
    try {
      const result = await authClient.twoFactor.verifyTotp({
        code: code.replace(/\s/g, ""),
      });
      if (result.error) {
        setMessage({
          type: "error",
          text: result.error.message || t("profile.twoFactor.codeRejected"),
        });
        return;
      }
      setEnrollment(null);
      setCode("");
      onEnabled?.();
      if (redirectTo) window.location.assign(redirectTo);
    } catch (error) {
      setMessage({
        type: "error",
        text: errorMessage(error, t("profile.twoFactor.codeRejected")),
      });
    } finally {
      setLoading(false);
    }
  }

  async function copyCodes() {
    if (!enrollment) return;
    await navigator.clipboard.writeText(enrollment.backupCodes.join("\n"));
    setMessage({ type: "success", text: t("profile.twoFactor.codesCopied") });
  }

  if (!enrollment) {
    return (
      <form className="space-y-3" onSubmit={beginSetup}>
        <p className="text-sm text-muted-foreground">
          {t("profile.twoFactor.confirmPassword")}
        </p>
        <Input
          aria-label={t("profile.twoFactor.currentPassword")}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("profile.twoFactor.currentPassword")}
          required
          autoFocus
        />
        <FormMessage message={message} />
        <div className="flex gap-2">
          <Button type="submit" disabled={loading}>
            {loading && <Loader2 className="animate-spin" />}
            {t("auth.continue")}
          </Button>
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
          )}
        </div>
      </form>
    );
  }

  return (
    <form className="space-y-4" onSubmit={verifySetup}>
      <div className="space-y-2 text-sm">
        <p className="font-medium">{t("profile.twoFactor.step1")}</p>
        <Image
          className="rounded-md border bg-white p-2"
          src={enrollment.qrCode}
          width={224}
          height={224}
          unoptimized
          alt={t("profile.twoFactor.qrAlt")}
        />
        <details className="text-muted-foreground">
          <summary className="cursor-pointer">
            {t("profile.twoFactor.cantScan")}
          </summary>
          <p className="mt-2 break-all">
            {t("profile.twoFactor.manualEntry", { uri: enrollment.uri })}
          </p>
        </details>
      </div>

      <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
        <p className="text-sm font-medium">{t("profile.twoFactor.step2")}</p>
        <p className="text-xs text-muted-foreground">
          {t("profile.twoFactor.recoveryHint")}
        </p>
        <div className="grid grid-cols-2 gap-1 rounded bg-background p-2 font-mono text-xs">
          {enrollment.backupCodes.map((backupCode) => (
            <span key={backupCode}>{backupCode}</span>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={copyCodes}>
          <Copy />
          {t("profile.twoFactor.copyCodes")}
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={backupCodesSaved}
            onCheckedChange={(checked) => setBackupCodesSaved(checked === true)}
          />
          {t("profile.twoFactor.savedCodes")}
        </label>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">{t("profile.twoFactor.step3")}</p>
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          pattern="[0-9]{6}"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          placeholder="123456"
          required
        />
      </div>

      <FormMessage message={message} />

      <Button type="submit" disabled={loading || !backupCodesSaved}>
        {loading && <Loader2 className="animate-spin" />}
        {t("profile.twoFactor.verifyEnable")}
      </Button>
    </form>
  );
}

/** Password-confirmed teardown. */
export function TwoFactorDisable({
  onDisabled,
  onCancel,
}: {
  onDisabled: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<FormMessageState>(null);

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLoading(true);
    try {
      const result = await authClient.twoFactor.disable({ password });
      if (result.error) {
        setMessage({
          type: "error",
          text: result.error.message || t("profile.twoFactor.disableFailed"),
        });
        return;
      }
      setPassword("");
      onDisabled();
    } catch (error) {
      setMessage({
        type: "error",
        text: errorMessage(error, t("profile.twoFactor.disableFailed")),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={disable}>
      <p className="text-sm text-muted-foreground">
        {t("profile.twoFactor.disableConfirm")}
      </p>
      <Input
        aria-label={t("profile.twoFactor.currentPassword")}
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t("profile.twoFactor.currentPassword")}
        required
        autoFocus
      />
      <FormMessage message={message} />
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" disabled={loading}>
          {loading && <Loader2 className="animate-spin" />}
          {t("profile.twoFactor.disableButton")}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
