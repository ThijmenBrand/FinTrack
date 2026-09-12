"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Fingerprint, Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { safeRedirectPath } from "@/lib/validation";
import {
  AuthHeading,
  AuthShell,
  authButtonClass,
  authInputClass,
} from "../_components/auth-shell";

type LoginStep = "email" | "password";

export default function LoginPage() {
  const { t } = useI18n();
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
  // Where a successful sign-in lands — e.g. back to a share invite the user
  // had to log in first to accept. Only same-origin paths are honored.
  const redirectTo = useRef("/");

  useEffect(() => {
    // window.location instead of useSearchParams to avoid a Suspense boundary
    const params = new URLSearchParams(window.location.search);
    const verified = params.get("verified") === "1";
    redirectTo.current = safeRedirectPath(params.get("redirect"));
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
        setError(result.error.message || t("auth.loginFailed"));
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
      router.push(redirectTo.current);
    } catch {
      setError(t("auth.genericError"));
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
        setError(String(result.error.message || t("auth.biometricFailed")));
        return;
      }
      if (email) {
        localStorage.setItem("lockscreen_username", email.trim());
      }
      localStorage.setItem("lockscreen_last_active", String(Date.now()));
      router.push(redirectTo.current);
    } catch {
      setError(t("auth.biometricFailedRetry"));
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
    <AuthShell>
      {justVerified && (
        <div className="mb-6 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
          {t("auth.emailVerified")}
        </div>
      )}

      {step === "email" ? (
        <form onSubmit={handleEmailContinue} className="space-y-5">
          <AuthHeading
            title={t("auth.signInToAccount")}
            subtitle={t("auth.signInSubtitle")}
          />

          <div className="space-y-2">
            <label
              htmlFor="email"
              className="text-sm font-medium leading-none text-foreground"
            >
              {t("auth.email")}
            </label>
            <input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={authInputClass}
              placeholder={t("auth.emailPlaceholder")}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={checkingMethods}
            className={authButtonClass}
          >
            {checkingMethods && <Loader2 className="h-4 w-4 animate-spin" />}
            {checkingMethods ? t("auth.checking") : t("auth.continue")}
          </button>

          {signupsEnabled && (
            <p className="text-sm text-muted-foreground">
              {t("auth.noAccount")}{" "}
              <Link
                href="/signup"
                className="font-medium text-primary hover:underline"
              >
                {t("auth.signUp")}
              </Link>
            </p>
          )}
        </form>
      ) : (
        <form onSubmit={handlePasswordSubmit} className="space-y-5">
          <button
            type="button"
            onClick={goBack}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("auth.back")}
          </button>

          <AuthHeading
            title={t("auth.enterPassword")}
            subtitle={t("auth.signingInAs", { email })}
          />

          <div className="space-y-2">
            <label
              htmlFor="password"
              className="text-sm font-medium leading-none text-foreground"
            >
              {t("auth.password")}
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={authInputClass}
              placeholder={t("auth.passwordPlaceholder")}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button type="submit" disabled={loading} className={authButtonClass}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? t("auth.signingIn") : t("auth.signIn")}
          </button>

          {hasWebAuthn && (
            <>
              <div className="relative flex items-center justify-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <span className="relative bg-background px-2 text-xs text-muted-foreground">
                  {t("auth.or")}
                </span>
              </div>

              <button
                type="button"
                onClick={handleBiometricLogin}
                disabled={loading}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-input bg-background px-4 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Fingerprint className="h-4 w-4" />
                )}
                {t("auth.signInBiometrics")}
              </button>
            </>
          )}

          <p className="text-sm">
            <Link
              href="/forgot-password"
              className="text-muted-foreground hover:text-foreground hover:underline"
            >
              {t("auth.forgotPassword")}
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
