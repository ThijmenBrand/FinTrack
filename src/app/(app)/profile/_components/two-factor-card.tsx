"use client";

import { useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { Copy, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { FormMessage, type FormMessageState } from "./form-message";

interface TwoFactorCardProps {
  enabled: boolean;
  required?: boolean;
  onEnabled?: () => void;
  redirectTo?: string;
}

type Enrollment = { uri: string; backupCodes: string[]; qrCode: string };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function TwoFactorCard({ enabled: initialEnabled, required = false, onEnabled, redirectTo }: TwoFactorCardProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [backupCodesSaved, setBackupCodesSaved] = useState(false);
  const [showSetup, setShowSetup] = useState(required && !initialEnabled);
  const [showDisable, setShowDisable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<FormMessageState>(null);

  async function beginSetup(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLoading(true);
    try {
      const result = await authClient.twoFactor.enable({ password });
      if (result.error || !result.data) {
        setMessage({ type: "error", text: result.error?.message || "Could not start two-factor setup" });
        return;
      }
      const qrCode = await QRCode.toDataURL(result.data.totpURI, { width: 224, margin: 1 });
      setEnrollment({ uri: result.data.totpURI, backupCodes: result.data.backupCodes, qrCode });
      setPassword("");
    } catch (error) {
      setMessage({ type: "error", text: errorMessage(error, "Could not start two-factor setup") });
    } finally {
      setLoading(false);
    }
  }

  async function verifySetup(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLoading(true);
    try {
      const result = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, "") });
      if (result.error) {
        setMessage({ type: "error", text: result.error.message || "That code was not accepted" });
        return;
      }
      setEnabled(true);
      setEnrollment(null);
      setCode("");
      setMessage({ type: "success", text: "Two-factor authentication is now enabled" });
      onEnabled?.();
      if (redirectTo) window.location.assign(redirectTo);
    } catch (error) {
      setMessage({ type: "error", text: errorMessage(error, "That code was not accepted") });
    } finally {
      setLoading(false);
    }
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLoading(true);
    try {
      const result = await authClient.twoFactor.disable({ password });
      if (result.error) {
        setMessage({ type: "error", text: result.error.message || "Could not disable two-factor authentication" });
        return;
      }
      setEnabled(false);
      setPassword("");
      setShowDisable(false);
      setMessage({ type: "success", text: "Two-factor authentication is disabled" });
    } catch (error) {
      setMessage({ type: "error", text: errorMessage(error, "Could not disable two-factor authentication") });
    } finally {
      setLoading(false);
    }
  }

  async function copyCodes() {
    if (!enrollment) return;
    await navigator.clipboard.writeText(enrollment.backupCodes.join("\n"));
    setMessage({ type: "success", text: "Recovery codes copied" });
  }

  return (
    <Card id="two-factor-authentication">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <KeyRound className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle>Two-factor authentication</CardTitle>
            <CardDescription>
              {enabled ? "Your account is protected with an authenticator app." : required ? "Required to use the FinTrack backoffice." : "Add an authenticator-app code when you sign in."}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormMessage message={message} />

        {enabled && !showDisable && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-green-200 bg-green-50 p-3 dark:border-green-900 dark:bg-green-950/30">
            <span className="flex items-center gap-2 text-sm font-medium text-green-800 dark:text-green-300"><ShieldCheck className="h-4 w-4" /> Enabled</span>
            {!required && <Button variant="outline" size="sm" onClick={() => { setShowDisable(true); setMessage(null); }}>Disable</Button>}
          </div>
        )}

        {!enabled && !showSetup && (
          <Button onClick={() => { setShowSetup(true); setMessage(null); }}>Set up two-factor authentication</Button>
        )}

        {!enabled && showSetup && !enrollment && (
          <form className="space-y-3" onSubmit={beginSetup}>
            <p className="text-sm text-muted-foreground">Confirm your password to create an authenticator-app setup code.</p>
            <Input aria-label="Current password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Current password" required />
            <div className="flex gap-2">
              <Button type="submit" disabled={loading}>{loading && <Loader2 className="animate-spin" />}Continue</Button>
              {!required && <Button type="button" variant="outline" onClick={() => setShowSetup(false)}>Cancel</Button>}
            </div>
          </form>
        )}

        {!enabled && enrollment && (
          <form className="space-y-4" onSubmit={verifySetup}>
            <div className="space-y-2 text-sm">
              <p className="font-medium">1. Scan this code with your authenticator app</p>
              <Image className="rounded-md border bg-white p-2" src={enrollment.qrCode} width={224} height={224} unoptimized alt="Authenticator app setup QR code" />
              <details className="text-muted-foreground"><summary className="cursor-pointer">Can&apos;t scan the code?</summary><p className="mt-2 break-all">Add the account manually using: {enrollment.uri}</p></details>
            </div>
            <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
              <p className="font-medium text-sm">2. Save your recovery codes</p>
              <p className="text-xs text-muted-foreground">Each code works once if you lose access to your authenticator. Store them somewhere safe.</p>
              <div className="grid grid-cols-2 gap-1 rounded bg-background p-2 font-mono text-xs">{enrollment.backupCodes.map((backupCode) => <span key={backupCode}>{backupCode}</span>)}</div>
              <Button type="button" variant="outline" size="sm" onClick={copyCodes}><Copy />Copy codes</Button>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={backupCodesSaved} onCheckedChange={(checked) => setBackupCodesSaved(checked === true)} />I&apos;ve saved these recovery codes</label>
            </div>
            <div className="space-y-2">
              <p className="font-medium text-sm">3. Enter the 6-digit code from your app</p>
              <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" required />
            </div>
            <Button type="submit" disabled={loading || !backupCodesSaved}>{loading && <Loader2 className="animate-spin" />}Verify and enable</Button>
          </form>
        )}

        {enabled && showDisable && !required && (
          <form className="space-y-3 rounded-md border border-destructive/20 bg-destructive/5 p-3" onSubmit={disable}>
            <p className="text-sm">Enter your password to disable two-factor authentication.</p>
            <Input aria-label="Current password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Current password" required />
            <div className="flex gap-2"><Button type="submit" variant="destructive" disabled={loading}>{loading && <Loader2 className="animate-spin" />}Disable two-factor authentication</Button><Button type="button" variant="outline" onClick={() => { setShowDisable(false); setPassword(""); }}>Cancel</Button></div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
