"use client";

import { useState, useEffect, useRef } from "react";
import { Landmark, ArrowLeft, Fingerprint } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { useVerifyPin } from "@/hooks/use-pin";

type LoginStep = "username" | "method" | "password" | "pin";

export default function LoginPage() {
  const [step, setStep] = useState<LoginStep>("username");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasPin, setHasPin] = useState(false);
  const [hasWebAuthn, setHasWebAuthn] = useState(false);
  const [checkingMethods, setCheckingMethods] = useState(false);
  const router = useRouter();
  const verifyPin = useVerifyPin();
  const pinInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus PIN input when switching to PIN step
  useEffect(() => {
    if (step === "pin" && pinInputRef.current) {
      pinInputRef.current.focus();
    }
  }, [step]);

  async function handleUsernameContinue(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCheckingMethods(true);

    try {
      // Always offer PIN as an option to avoid leaking which accounts have PIN enabled.
      // If the user doesn't have a PIN, the verify endpoint will reject the attempt.
      setHasPin(true);

      const webAuthnAvailable =
        typeof window !== "undefined" && window.PublicKeyCredential
          ? await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
          : false;

      setHasWebAuthn(webAuthnAvailable);
      setStep("method");
    } catch {
      // Fallback to password if checks fail
      setStep("password");
    } finally {
      setCheckingMethods(false);
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await authClient.signIn.username({
        username,
        password,
      });

      if (result.error) {
        setError(result.error.message || "Login failed");
        return;
      }

      router.push("/");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handlePinSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await verifyPin.mutateAsync({ username, pin });
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid PIN");
      setPin("");
    } finally {
      setLoading(false);
    }
  }

  async function handleBiometricLogin() {
    setError("");
    setLoading(true);

    try {
      const result = await authClient.signIn.passkey();
      if (result.error) {
        setError(String(result.error.message || "Biometric authentication failed"));
        return;
      }
      router.push("/");
    } catch {
      setError("Biometric authentication failed. Try another method.");
    } finally {
      setLoading(false);
    }
  }

  function goBack() {
    setError("");
    setPin("");
    setPassword("");
    if (step === "password" || step === "pin") {
      if (hasPin || hasWebAuthn) {
        setStep("method");
      } else {
        setStep("username");
      }
    } else if (step === "method") {
      setStep("username");
    }
  }

  return (
    <div className="w-full max-w-sm">
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
            {step === "username" && "Sign in to your account"}
            {step === "method" && "Choose how to sign in"}
            {step === "password" && "Enter your password"}
            {step === "pin" && "Enter your PIN"}
          </p>
        </div>

        {/* Back button */}
        {step !== "username" && (
          <button
            onClick={goBack}
            className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        )}

        {/* Username Step */}
        {step === "username" && (
          <form onSubmit={handleUsernameContinue} className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="username"
                className="text-sm font-medium leading-none text-foreground"
              >
                Username
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                autoFocus
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder="Enter your username"
              />
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button
              type="submit"
              disabled={checkingMethods}
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            >
              {checkingMethods ? "Checking..." : "Continue"}
            </button>
          </form>
        )}

        {/* Method Picker */}
        {step === "method" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground text-center mb-2">
              Signing in as <span className="font-medium text-foreground">{username}</span>
            </p>

            {hasWebAuthn && (
              <button
                onClick={handleBiometricLogin}
                disabled={loading}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                <Fingerprint className="h-5 w-5" />
                Face ID / Biometric
              </button>
            )}

            {hasPin && (
              <button
                onClick={() => { setError(""); setStep("pin"); }}
                disabled={loading}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                PIN Code
              </button>
            )}

            <button
              onClick={() => { setError(""); setStep("password"); }}
              disabled={loading}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            >
              Password
            </button>

            {error && <p className="text-sm text-red-500 text-center">{error}</p>}
          </div>
        )}

        {/* Password Form */}
        {step === "password" && (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <p className="text-xs text-muted-foreground text-center">
              Signing in as <span className="font-medium text-foreground">{username}</span>
            </p>

            <div className="space-y-2">
              <label
                htmlFor="password"
                className="text-sm font-medium leading-none text-foreground"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                autoFocus
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder="Enter your password"
              />
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        )}

        {/* PIN Form */}
        {step === "pin" && (
          <form onSubmit={handlePinSubmit} className="space-y-4">
            <p className="text-xs text-muted-foreground text-center">
              Signing in as <span className="font-medium text-foreground">{username}</span>
            </p>

            <div className="space-y-2">
              <label
                htmlFor="pinLogin"
                className="text-sm font-medium leading-none text-foreground"
              >
                PIN Code
              </label>
              <input
                id="pinLogin"
                ref={pinInputRef}
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                required
                minLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                className="flex h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-lg tracking-[0.5em] text-center ring-offset-background placeholder:text-muted-foreground placeholder:tracking-normal placeholder:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder="Enter PIN"
              />
              {/* PIN dots indicator */}
              <div className="flex justify-center gap-2 pt-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-2.5 w-2.5 rounded-full transition-colors ${
                      i < pin.length
                        ? "bg-primary"
                        : "bg-muted"
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
              {loading ? "Verifying..." : "Sign in with PIN"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
