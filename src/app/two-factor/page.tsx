"use client";

import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/client";

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
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center"><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"><KeyRound className="h-6 w-6" /></div><h1 className="text-xl font-semibold">{t("twoFactorVerify.title")}</h1><p className="text-sm text-muted-foreground">{t("twoFactorVerify.subtitle")}</p></div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2"><label className="text-sm font-medium" htmlFor="two-factor-code">{useRecoveryCode ? t("twoFactorVerify.recoveryCode") : t("twoFactorVerify.authCode")}</label><Input id="two-factor-code" autoFocus autoComplete="one-time-code" inputMode={useRecoveryCode ? undefined : "numeric"} maxLength={useRecoveryCode ? undefined : 6} pattern={useRecoveryCode ? undefined : "[0-9]{6}"} value={useRecoveryCode ? recoveryCode : code} onChange={(e) => useRecoveryCode ? setRecoveryCode(e.target.value) : setCode(e.target.value.replace(/\D/g, ""))} placeholder={useRecoveryCode ? t("twoFactorVerify.recoveryPlaceholder") : "123456"} required /></div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <Button className="w-full" type="submit" disabled={loading}>{loading && <Loader2 className="animate-spin" />}{t("twoFactorVerify.verify")}</Button>
        </form>
        <button type="button" className="mt-4 w-full text-sm text-muted-foreground hover:text-foreground hover:underline" onClick={() => { setUseRecoveryCode(!useRecoveryCode); setError(""); }}>{useRecoveryCode ? t("twoFactorVerify.useAuthCode") : t("twoFactorVerify.useRecoveryCode")}</button>
      </div>
    </main>
  );
}
