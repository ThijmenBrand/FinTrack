"use client";

import { useState, useEffect, useRef } from "react";
import { Landmark, ShieldCheck } from "lucide-react";
import { useHasPin, useInitialSetupPin } from "@/hooks/use-pin";
import { useSession } from "@/lib/auth-client";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import { PinInput } from "@/components/pin-input";

export function PinSetupScreen() {
  const { data: session, isPending: sessionLoading } = useSession();
  const { data: pinStatus, isPending: pinLoading, isError: pinError } = useHasPin();
  const initialSetup = useInitialSetupPin();
  const queryClient = useQueryClient();

  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const pinInputRef = useRef<HTMLInputElement>(null);
  const confirmInputRef = useRef<HTMLInputElement>(null);

  // Detect if running as installed PWA (standalone mode)
  useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    setIsStandalone(mq.matches || (navigator as { standalone?: boolean }).standalone === true);
    const handler = (e: MediaQueryListEvent) => setIsStandalone(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

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
      setError("PIN must be at least 4 digits");
      return;
    }

    setStep("confirm");
  }

  async function handleConfirmPin(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (pin !== confirmPin) {
      setError("PINs do not match. Please try again.");
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
      setError(err instanceof Error ? err.message : "Failed to set PIN");
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="w-full max-w-sm px-4">
        <div className="rounded-xl border bg-card p-8 shadow-sm">
          {/* Logo */}
          <div className="mb-6 flex flex-col items-center gap-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Landmark className="h-6 w-6" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              FinTrack
            </h1>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <ShieldCheck className="h-4 w-4" />
              Set up your PIN
            </div>
            <p className="text-xs text-muted-foreground text-center max-w-[250px]">
              {step === "enter"
                ? "Choose a 4-6 digit PIN to quickly and securely access the app."
                : "Enter your PIN again to confirm."}
            </p>
          </div>

          {/* Enter PIN */}
          {step === "enter" && (
            <form onSubmit={handleEnterPin} className="space-y-4">
              <PinInput
                id="setupPin"
                label="New PIN"
                value={pin}
                onChange={setPin}
                placeholder="Enter PIN"
                inputRef={pinInputRef}
              />

              {error && <p className="text-sm text-red-500 text-center">{error}</p>}

              <button
                type="submit"
                disabled={pin.length < 4}
                className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                Continue
              </button>
            </form>
          )}

          {/* Confirm PIN */}
          {step === "confirm" && (
            <form onSubmit={handleConfirmPin} className="space-y-4">
              <PinInput
                id="confirmPin"
                label="Confirm PIN"
                value={confirmPin}
                onChange={setConfirmPin}
                placeholder="Confirm PIN"
                inputRef={confirmInputRef}
              />

              {error && <p className="text-sm text-red-500 text-center">{error}</p>}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleBack}
                  className="inline-flex h-10 flex-1 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={loading || confirmPin.length < 4}
                  className="inline-flex h-10 flex-1 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                >
                  {loading ? "Setting up..." : "Set PIN"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
