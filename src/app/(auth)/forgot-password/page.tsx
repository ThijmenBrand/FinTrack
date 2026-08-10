"use client";

import { useState } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { useI18n } from "@/lib/i18n/client";
import {
  AuthHeading,
  AuthShell,
  authButtonClass,
  authInputClass,
  authSecondaryButtonClass,
} from "../_components/auth-shell";

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: "/reset-password",
      });
    } catch {
      // Deliberately swallowed — the response must not reveal whether the
      // email exists.
    } finally {
      // Always show the same message (no user enumeration).
      setDone(true);
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      {done ? (
        <div className="space-y-6">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <MailCheck className="h-6 w-6" />
          </span>
          <AuthHeading title={t("auth.checkEmail")} />
          <p className="text-pretty text-lg leading-relaxed text-muted-foreground">
            {t("auth.forgotDone")}
          </p>
          <Link href="/login" className={authSecondaryButtonClass}>
            {t("auth.backToSignIn")}
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <AuthHeading
            title={t("auth.forgotTitle")}
            subtitle={t("auth.forgotSubtitle")}
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

          <button type="submit" disabled={loading} className={authButtonClass}>
            {loading ? t("auth.sending") : t("auth.sendResetLink")}
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
      )}
    </AuthShell>
  );
}
