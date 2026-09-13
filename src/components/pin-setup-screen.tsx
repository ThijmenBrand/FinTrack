"use client";

import { useState, useEffect, useRef } from "react";
import { Landmark, ShieldCheck } from "lucide-react";
import { useHasPin, useInitialSetupPin } from "@/hooks/use-pin";
import { useSession } from "@/lib/auth-client";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import { PinInput } from "@/components/pin-input";
import { useI18n } from "@/lib/i18n/client";
import { useIsHydrated, useMediaQuery } from "@/hooks/use-browser";

export function PinSetupScreen() {
  const { t } = useI18n();
  const { data: session, isPending: sessionLoading } = useSession();
  const { data: pinStatus, isPending: pinLoading, isError: pinError } = useHasPin();
  const initialSetup = useInitialSetupPin();
  const queryClient = useQueryClient();

  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Detect if running as an installed PWA (standalone mode).
  const hydrated = useIsHydrated();
  const isStandalone =
    useMediaQuery("(display-mode: standalone)") ||
    (hydrated && (navigator as { standalone?: boolean }).standalone === true);
  const pinInputRef = useRef<HTMLInputElement>(null);
  const confirmInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus inputs
  useEffect(() => {
    if (step === "enter" && pinInputRef.current) pinInputRef.current.focus();
    if (step === "confirm" && confirmInputRef.current) confirmInputRef.current.focus();
  }, [step]);

  // Don't show if: not standalone, still loading, no session, or already has PIN
  if (!isStandalone) return null;
  if (sessionLoading || pinLoading) return null;
  if (!session?.user) return null;
  if (pinError) return null;
  if (pinStatus?.hasPin) return null;

  async function handleEnterPin(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (pin.length < 4) {
      setError(t("pinSetup.tooShort"));
      return;
    }

    setStep("confirm");
  }

  async function handleConfirmPin(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (pin !== confirmPin) {
      setError(t("pinSetup.mismatch"));
      setConfirmPin("");
      return;
    }

    setLoading(true);
    try {
      await initialSetup.mutateAsync({ pin });
      // Success - hasPin query will refetch and this screen will disappear
      localStorage.setItem("lockscreen_has_pin", "true");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // PIN already exists — refresh status so this screen dismisses
        localStorage.setItem("lockscreen_has_pin", "true");
        queryClient.invalidateQueries({ queryKey: ["pin-status"] });
        return;
      }
      setError(err instanceof Error ? err.message : t("pinSetup.failed"));
      setPin("");
      setConfirmPin("");
      setStep("enter");
    } finally {
      setLoading(false);
    }
  }

  function handleBack() {
    setConfirmPin("");
    setError("");
    setStep("enter");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background p-4">
      {/* Soft primary glow for depth — static, decoration-free. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_35%,var(--primary),transparent)] opacity-[0.06]"
      />

      <div className="relative w-full max-w-sm">
        <div className="rounded-2xl border bg-card p-8 shadow-xl ring-1 ring-black/[0.04] dark:ring-white/[0.04]">
          {/* Logo */}
          <div className="mb-7 flex flex-col items-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md shadow-primary/25 ring-1 ring-inset ring-white/15">
              <Landmark className="h-7 w-7" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                {t("nav.appShortName")}
              </h1>
              <div className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4" />
                {t("pinSetup.title")}
              </div>
              <p className="mx-auto max-w-[250px] text-xs text-muted-foreground">
                {step === "enter"
                  ? t("pinSetup.enterHint")
                  : t("pinSetup.confirmHint")}
              </p>
            </div>
          </div>

          {/* Enter PIN */}
          {step === "enter" && (
            <form onSubmit={handleEnterPin} className="space-y-4">
              <PinInput
                id="setupPin"
                label={t("pinSetup.newPin")}
                value={pin}
                onChange={setPin}
                inputRef={pinInputRef}
                invalid={!!error}
              />

              {error && (
                <p className="text-center text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={pin.length < 4}
                className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-[background-color,transform] hover:bg-primary/90 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:pointer-events-none disabled:opacity-50"
              >
                {t("auth.continue")}
              </button>
            </form>
          )}

          {/* Confirm PIN */}
          {step === "confirm" && (
            <form onSubmit={handleConfirmPin} className="space-y-4">
              <PinInput
                id="confirmPin"
                label={t("pinSetup.confirmPin")}
                value={confirmPin}
                onChange={setConfirmPin}
                inputRef={confirmInputRef}
                invalid={!!error}
              />

              {error && (
                <p className="text-center text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleBack}
                  className="inline-flex h-11 flex-1 items-center justify-center rounded-lg border border-input bg-background px-4 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("auth.back")}
                </button>
                <button
                  type="submit"
                  disabled={loading || confirmPin.length < 4}
                  className="inline-flex h-11 flex-1 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-[background-color,transform] hover:bg-primary/90 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                >
                  {loading ? t("pinSetup.settingUp") : t("pinSetup.setPin")}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
