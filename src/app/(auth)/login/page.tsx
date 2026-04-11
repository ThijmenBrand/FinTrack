"use client";

import { useState } from "react";
import { Landmark, ArrowLeft, Fingerprint } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

type LoginStep = "username" | "password";

export default function LoginPage() {
  const [step, setStep] = useState<LoginStep>("username");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasWebAuthn, setHasWebAuthn] = useState(false);
  const [checkingMethods, setCheckingMethods] = useState(false);
  const router = useRouter();

  async function handleUsernameContinue(e: React.FormEvent) {
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
      const result = await authClient.signIn.username({
        username,
        password,
      });

      if (result.error) {
        setError(result.error.message || "Login failed");
        return;
      }

      localStorage.setItem("lockscreen_username", username);
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
      if (username) {
        localStorage.setItem("lockscreen_username", username);
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
    setPassword("");
    setStep("username");
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
            {step === "password" && "Enter your password"}
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
