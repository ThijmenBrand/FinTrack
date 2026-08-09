"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Landmark, ArrowLeft, Fingerprint } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

type LoginStep = "email" | "password";

export default function LoginPage() {
  const [step, setStep] = useState<LoginStep>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasWebAuthn, setHasWebAuthn] = useState(false);
  const [checkingMethods, setCheckingMethods] = useState(false);
  const [signupsEnabled, setSignupsEnabled] = useState(false);
  const [justVerified, setJustVerified] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // window.location instead of useSearchParams to avoid a Suspense boundary
    const verified =
      new URLSearchParams(window.location.search).get("verified") === "1";
    fetch("/api/signup-status")
      .then((r) => r.json())
      .then((d) => setSignupsEnabled(!!d.enabled))
      .catch(() => {})
      .finally(() => setJustVerified(verified));
  }, []);

  async function handleEmailContinue(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCheckingMethods(true);

    try {
      const webAuthnAvailable =
        typeof window !== "undefined" && window.PublicKeyCredential
          ? await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
          : false;

      setHasWebAuthn(webAuthnAvailable);
      setStep("password");
    } catch {
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
      const result = await authClient.signIn.email({
        email: email.trim(),
        password,
      });

      if (result.error) {
        setError(result.error.message || "Login failed");
        return;
      }

      // No session yet when a second factor is owed — the two-factor client
      // plugin is already navigating to /two-factor, and pushing "/" here would
      // race it and land on the login page again.
      if ((result.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
        return;
      }

      // ponytail: the lockscreen key predates email login — it holds an email now.
      localStorage.setItem("lockscreen_username", email.trim());
      localStorage.setItem("lockscreen_last_active", String(Date.now()));
      router.push("/");
    } catch {
      setError("Something went wrong. Please try again.");
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
      if (email) {
        localStorage.setItem("lockscreen_username", email.trim());
      }
      localStorage.setItem("lockscreen_last_active", String(Date.now()));
      router.push("/");
    } catch {
      setError("Biometric authentication failed. Try another method.");
    } finally {
      setLoading(false);
    }
  }

  function goBack() {
    setError("");
    setPassword("");
    setStep("email");
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
            {step === "email" && "Sign in to your account"}
            {step === "password" && "Enter your password"}
          </p>
        </div>

        {/* Back button */}
        {step !== "email" && (
          <button
            onClick={goBack}
            className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        )}

        {justVerified && (
          <div className="mb-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
            Email verified — you can sign in now.
          </div>
        )}

        {/* Email Step */}
        {step === "email" && (
          <form onSubmit={handleEmailContinue} className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="email"
                className="text-sm font-medium leading-none text-foreground"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder="you@example.com"
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

            {signupsEnabled && (
              <p className="text-center text-sm text-muted-foreground">
                Don&apos;t have an account?{" "}
                <Link href="/signup" className="font-medium text-primary hover:underline">
                  Sign up
                </Link>
              </p>
            )}
          </form>
        )}

        {/* Password Form */}
        {step === "password" && (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <p className="text-xs text-muted-foreground text-center">
              Signing in as <span className="font-medium text-foreground">{email}</span>
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

            <p className="text-center text-sm">
              <Link
                href="/forgot-password"
                className="text-muted-foreground hover:text-foreground hover:underline"
              >
                Forgot password?
              </Link>
            </p>

            {hasWebAuthn && (
              <>
                <div className="relative flex items-center justify-center">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border" />
                  </div>
                  <span className="relative bg-card px-2 text-xs text-muted-foreground">or</span>
                </div>

                <button
                  type="button"
                  onClick={handleBiometricLogin}
                  disabled={loading}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                >
                  <Fingerprint className="h-4 w-4" />
                  Sign in with biometrics
                </button>
              </>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
