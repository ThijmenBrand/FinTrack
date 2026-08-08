"use client";

import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function TwoFactorChallengePage() {
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
        setError(result.error.message || "That code was not accepted");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("That code was not accepted");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center"><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"><KeyRound className="h-6 w-6" /></div><h1 className="text-xl font-semibold">Verify it&apos;s you</h1><p className="text-sm text-muted-foreground">Enter the code from your authenticator app to finish signing in.</p></div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2"><label className="text-sm font-medium" htmlFor="two-factor-code">{useRecoveryCode ? "Recovery code" : "Authentication code"}</label><Input id="two-factor-code" autoFocus autoComplete="one-time-code" inputMode={useRecoveryCode ? undefined : "numeric"} maxLength={useRecoveryCode ? undefined : 6} pattern={useRecoveryCode ? undefined : "[0-9]{6}"} value={useRecoveryCode ? recoveryCode : code} onChange={(e) => useRecoveryCode ? setRecoveryCode(e.target.value) : setCode(e.target.value.replace(/\D/g, ""))} placeholder={useRecoveryCode ? "Enter a saved recovery code" : "123456"} required /></div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <Button className="w-full" type="submit" disabled={loading}>{loading && <Loader2 className="animate-spin" />}Verify</Button>
        </form>
        <button type="button" className="mt-4 w-full text-sm text-muted-foreground hover:text-foreground hover:underline" onClick={() => { setUseRecoveryCode(!useRecoveryCode); setError(""); }}>{useRecoveryCode ? "Use an authenticator code" : "Use a recovery code"}</button>
      </div>
    </main>
  );
}
