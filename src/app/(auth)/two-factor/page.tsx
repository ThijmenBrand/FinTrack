"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useI18n } from "@/lib/i18n/client";
import {
  AuthHeading,
  AuthShell,
  authButtonClass,
  authInputClass,
} from "../_components/auth-shell";

export default function TwoFactorChallengePage() {
  const { t } = useI18n();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = useRecoveryCode
        ? await authClient.twoFactor.verifyBackupCode({ code: recoveryCode.trim() })
        : await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, "") });
      if (result.error) {
        setError(result.error.message || t("profile.twoFactor.codeRejected"));
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError(t("profile.twoFactor.codeRejected"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <form className="space-y-5" onSubmit={handleSubmit}>
        <AuthHeading
          title={t("twoFactorVerify.title")}
          subtitle={t("twoFactorVerify.subtitle")}
        />

        <div className="space-y-2">
          <label
            htmlFor="two-factor-code"
            className="text-sm font-medium leading-none text-foreground"
          >
            {useRecoveryCode
              ? t("twoFactorVerify.recoveryCode")
              : t("twoFactorVerify.authCode")}
          </label>
          <input
            id="two-factor-code"
            autoFocus
            required
            autoComplete="one-time-code"
            inputMode={useRecoveryCode ? undefined : "numeric"}
            maxLength={useRecoveryCode ? undefined : 6}
            pattern={useRecoveryCode ? undefined : "[0-9]{6}"}
            value={useRecoveryCode ? recoveryCode : code}
            onChange={(e) =>
              useRecoveryCode
                ? setRecoveryCode(e.target.value)
                : setCode(e.target.value.replace(/\D/g, ""))
            }
            className={authInputClass}
            placeholder={
              useRecoveryCode ? t("twoFactorVerify.recoveryPlaceholder") : "123456"
            }
          />
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={loading} className={authButtonClass}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("twoFactorVerify.verify")}
        </button>

        <p className="text-sm">
          <button
            type="button"
            className="text-muted-foreground transition-colors hover:text-foreground hover:underline"
            onClick={() => {
              setUseRecoveryCode(!useRecoveryCode);
              setError("");
            }}
          >
            {useRecoveryCode
              ? t("twoFactorVerify.useAuthCode")
              : t("twoFactorVerify.useRecoveryCode")}
          </button>
        </p>
      </form>
    </AuthShell>
  );
}
