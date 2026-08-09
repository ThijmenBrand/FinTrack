"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Landmark, MailCheck } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { MIN_PASSWORD_LENGTH } from "@/lib/validation";
import { useI18n } from "@/lib/i18n/client";

const inputClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export default function SignupPage() {
  const { t } = useI18n();
  const [signupsEnabled, setSignupsEnabled] = useState<boolean | null>(null);
  const [username, setUsername] = useState("");
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
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }

    setLoading(true);
    try {
      const result = await authClient.signUp.email({
        email: email.trim(),
        password,
        name: displayName.trim(),
        username: username.trim(),
        displayUsername: displayName.trim(),
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

  return (
    <div className="w-full max-w-sm">
      <div className="rounded-xl border bg-card p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            {done ? <MailCheck className="h-6 w-6" /> : <Landmark className="h-6 w-6" />}
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {t("nav.appShortName")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {done ? t("auth.checkEmail") : t("auth.createAccountSubtitle")}
          </p>
        </div>

        {done ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              {t("auth.verificationSent", { email })}
            </p>
            <Link
              href="/login"
              className="inline-flex h-10 w-full items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {t("auth.backToSignIn")}
            </Link>
          </div>
        ) : signupsEnabled === null ? (
          <p className="text-center text-sm text-muted-foreground">{t("auth.loading")}</p>
        ) : !signupsEnabled ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              {t("auth.signupsClosed")}
            </p>
            <Link
              href="/login"
              className="inline-flex h-10 w-full items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {t("auth.backToSignIn")}
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="username" className="text-sm font-medium leading-none text-foreground">
                {t("auth.username")}
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                autoFocus
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={inputClass}
                placeholder={t("auth.usernamePlaceholder")}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="displayName" className="text-sm font-medium leading-none text-foreground">
                {t("auth.displayName")}
              </label>
              <input
                id="displayName"
                type="text"
                autoComplete="name"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={inputClass}
                placeholder={t("auth.displayNamePlaceholder")}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium leading-none text-foreground">
                {t("auth.email")}
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                placeholder={t("auth.emailPlaceholder")}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium leading-none text-foreground">
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
                className={inputClass}
                placeholder={t("auth.passwordMinChars", { count: MIN_PASSWORD_LENGTH })}
              />
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            >
              {loading ? t("auth.creatingAccount") : t("auth.createAccount")}
            </button>

            <p className="text-center text-sm text-muted-foreground">
              {t("auth.haveAccount")}{" "}
              <Link href="/login" className="font-medium text-primary hover:underline">
                {t("auth.signIn")}
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
