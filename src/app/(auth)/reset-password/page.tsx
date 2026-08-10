"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { MIN_PASSWORD_LENGTH } from "@/lib/validation";
import { useI18n } from "@/lib/i18n/client";
import {
  AuthHeading,
  AuthShell,
  authButtonClass,
  authInputClass,
  authSecondaryButtonClass,
} from "../_components/auth-shell";

function ResetPasswordForm() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t("auth.passwordMinChars", { count: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (!token) {
      setError(t("auth.resetInvalidToken"));
      return;
    }

    setLoading(true);
    try {
      const result = await authClient.resetPassword({
        newPassword: password,
        token,
      });
      if (result.error) {
        setError(result.error.message || t("auth.resetFailed"));
        return;
      }
      router.push("/login");
    } catch {
      setError(t("auth.genericError"));
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthShell>
        <div className="space-y-6">
          <AuthHeading title={t("auth.resetTitle")} />
          <p className="text-pretty text-muted-foreground">
            {t("auth.resetInvalid")}
          </p>
          <Link href="/forgot-password" className={authSecondaryButtonClass}>
            {t("auth.requestNewLink")}
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form onSubmit={handleSubmit} className="space-y-5">
        <AuthHeading
          title={t("auth.resetTitle")}
          subtitle={t("auth.resetSubtitle")}
        />

        <div className="space-y-2">
          <label
            htmlFor="password"
            className="text-sm font-medium leading-none text-foreground"
          >
            {t("auth.newPassword")}
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            autoFocus
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

        <button type="submit" disabled={loading} className={authButtonClass}>
          {loading ? t("auth.resetting") : t("auth.resetPassword")}
        </button>

        <p className="text-sm">
          <Link
            href="/login"
            className="text-muted-foreground hover:text-foreground hover:underline"
          >
            {t("auth.backToSignIn")}
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
