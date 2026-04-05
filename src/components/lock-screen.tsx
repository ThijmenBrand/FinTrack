"use client";

import { useState, useEffect, useRef } from "react";
import { Landmark, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";
import { useUnlockPin } from "@/hooks/use-pin";
import { useLockScreen } from "@/components/lock-screen-provider";
import { ApiError } from "@/lib/api";

export function LockScreen() {
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
      setError(err instanceof Error ? err.message : "Invalid PIN");
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
            <p className="text-sm text-muted-foreground">
              Welcome back, <span className="font-medium text-foreground">{username}</span>
            </p>
          </div>

          {/* PIN Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="lockPin"
                className="text-sm font-medium leading-none text-foreground"
              >
                PIN Code
              </label>
              <input
                id="lockPin"
                ref={pinInputRef}
                type="tel"
                pattern="[0-9]*"
                maxLength={6}
                required
                minLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                autoComplete="off"
                className="flex h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-lg tracking-[0.5em] text-center text-transparent caret-transparent selection:bg-transparent ring-offset-background placeholder:text-muted-foreground placeholder:tracking-normal placeholder:text-sm placeholder:text-opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder="Enter PIN"
              />
              {/* PIN dots indicator */}
              <div className="flex justify-center gap-2 pt-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-2.5 w-2.5 rounded-full transition-colors ${
                      i < pin.length ? "bg-primary" : "bg-muted"
                    }`}
                  />
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-red-500 text-center">{error}</p>}

            <button
              type="submit"
              disabled={loading || pin.length < 4}
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            >
              {loading ? "Verifying..." : "Unlock"}
            </button>
          </form>

          {/* Sign out */}
          <button
            onClick={handleSignOut}
            className="mt-4 flex w-full items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
