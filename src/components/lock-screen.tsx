"use client";

import { useState, useEffect, useRef } from "react";
import { Landmark, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";
import { useUnlockPin } from "@/hooks/use-pin";
import { useLockScreen } from "@/components/lock-screen-provider";
import { ApiError } from "@/lib/api";
import { PinInput } from "@/components/pin-input";
import { useI18n } from "@/lib/i18n/client";

export function LockScreen() {
  const { t } = useI18n();
  const { isLocked, username, unlock, clearLockState } = useLockScreen();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const pinInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const unlockPin = useUnlockPin();

  useEffect(() => {
    if (isLocked && pinInputRef.current) {
      pinInputRef.current.focus();
    }
  }, [isLocked]);

  if (!isLocked) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await unlockPin.mutateAsync({ pin });
      setPin("");
      unlock();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        clearLockState();
        await signOut();
        router.push("/login");
        return;
      }
      if (err instanceof ApiError && err.status === 401) {
        if (err.message.toLowerCase().includes("session expired")) {
          clearLockState();
          router.push("/login");
          return;
        }
      }
      setError(err instanceof Error ? err.message : t("lock.invalidPin"));
      setPin("");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    clearLockState();
    await signOut();
    router.push("/login");
    router.refresh();
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
            <div className="space-y-1">
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                {t("nav.appShortName")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("lock.welcomeBack")}{" "}
                <span className="font-medium text-foreground">{username}</span>
              </p>
            </div>
          </div>

          {/* PIN Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <PinInput
              id="lockPin"
              label={t("lock.pinCode")}
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
              disabled={loading || pin.length < 4}
              className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-[background-color,transform] hover:bg-primary/90 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:pointer-events-none disabled:opacity-50"
            >
              {loading ? t("lock.verifying") : t("lock.unlock")}
            </button>
          </form>

          {/* Sign out */}
          <button
            onClick={handleSignOut}
            className="mt-5 flex w-full items-center justify-center gap-2 border-t border-border/60 pt-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            {t("lock.signOut")}
          </button>
        </div>
      </div>
    </div>
  );
}
