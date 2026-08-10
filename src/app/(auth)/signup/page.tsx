"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { MIN_PASSWORD_LENGTH } from "@/lib/validation";
import { useI18n } from "@/lib/i18n/client";
import {
  AuthShell,
  authButtonClass,
  authInputClass,
  authSecondaryButtonClass,
} from "../_components/auth-shell";

export default function SignupPage() {
  const { t } = useI18n();
  const [signupsEnabled, setSignupsEnabled] = useState<boolean | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch("/api/signup-status")
      .then((r) => r.json())
      .then((d) => setSignupsEnabled(!!d.enabled))
      .catch(() => setSignupsEnabled(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t("auth.passwordMinChars", { count: MIN_PASSWORD_LENGTH }));
      return;
    }

    setLoading(true);
    try {
      const result = await authClient.signUp.email({
        email: email.trim(),
        password,
        name: displayName.trim(),
        callbackURL: "/login?verified=1",
      });
      if (result.error) {
        setError(result.error.message || t("auth.signUpFailed"));
        return;
      }
      setDone(true);
    } catch {
      setError(t("auth.genericError"));
    } finally {
      setLoading(false);
    }
  }

  const backToSignIn = (
    <Link
      href="/login"
      className={authSecondaryButtonClass}
    >
      {t("auth.backToSignIn")}
    </Link>
  );

  return (
    <AuthShell>
      {done ? (
        <div className="space-y-6">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <MailCheck className="h-6 w-6" />
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {t("auth.checkEmail")}
          </h1>
          <p className="text-pretty text-lg leading-relaxed text-muted-foreground">
            {t("auth.verificationSent", { email })}
          </p>
          {backToSignIn}
        </div>
      ) : signupsEnabled === null ? (
        <p className="text-sm text-muted-foreground">{t("auth.loading")}</p>
      ) : !signupsEnabled ? (
        <div className="space-y-6">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            {t("auth.createAccountSubtitle")}
          </h1>
          <p className="text-muted-foreground">{t("auth.signupsClosed")}</p>
          {backToSignIn}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {t("auth.createAccountSubtitle")}
            </h1>
            <p className="text-muted-foreground">{t("auth.signupSubtitle")}</p>
          </div>
          <div className="space-y-2">
            <label
              htmlFor="displayName"
              className="text-sm font-medium leading-none text-foreground"
            >
              {t("auth.displayName")}
            </label>
            <input
              id="displayName"
              type="text"
              autoComplete="name"
              autoFocus
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={authInputClass}
              placeholder={t("auth.displayNamePlaceholder")}
            />
          </div>

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
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={authInputClass}
              placeholder={t("auth.emailPlaceholder")}
            />
          </div>

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
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={authInputClass}
              placeholder={t("auth.passwordMinChars", {
                count: MIN_PASSWORD_LENGTH,
              })}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className={authButtonClass}
          >
            {loading ? t("auth.creatingAccount") : t("auth.createAccount")}
          </button>

          <p className="text-sm text-muted-foreground">
            {t("auth.haveAccount")}{" "}
            <Link
              href="/login"
              className="font-medium text-primary hover:underline"
            >
              {t("auth.signIn")}
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
