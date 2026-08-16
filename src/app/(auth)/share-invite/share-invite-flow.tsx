"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { MIN_PASSWORD_LENGTH } from "@/lib/validation";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import {
  AuthHeading,
  AuthShell,
  authButtonClass,
  authInputClass,
  authSecondaryButtonClass,
} from "../_components/auth-shell";

interface ShareInviteInfo {
  accountName: string;
  ownerName: string | null;
  email: string;
  role: "viewer" | "editor";
  userExists: boolean;
}

const ROLE_LABEL: Record<ShareInviteInfo["role"], MessageKey> = {
  viewer: "sharing.role.viewer",
  editor: "sharing.role.editor",
};

type Status = "loading" | "invalid" | "ready" | "done";

export default function ShareInviteFlow() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { data: session, isPending: sessionLoading } = useSession();
  const token = useRef("");

  const [status, setStatus] = useState<Status>("loading");
  // Mirrors token.current for render (the /login redirect link) — refs can't
  // be read during render.
  const [tokenParam, setTokenParam] = useState("");
  const [invite, setInvite] = useState<ShareInviteInfo | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    // window.location instead of useSearchParams to avoid a Suspense boundary.
    const t = new URLSearchParams(window.location.search).get("token") || "";
    token.current = t;
    (t
      ? fetch(`/api/shares/accept?token=${encodeURIComponent(t)}`)
          .then((r) => (r.ok ? (r.json() as Promise<ShareInviteInfo>) : null))
          .catch(() => null)
      : Promise.resolve(null)
    ).then((data) => {
      setTokenParam(t);
      setInvite(data);
      setStatus(data ? "ready" : "invalid");
    });
  }, []);

  async function acceptAsLoggedIn() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/shares/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.current }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 410) {
          setStatus("invalid");
        } else {
          setError(data.error || t("auth.genericError"));
        }
        return;
      }
      setStatus("done");
      router.push("/accounts");
    } catch {
      setError(t("auth.genericError"));
    } finally {
      setLoading(false);
    }
  }

  async function handleSignupSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t("auth.passwordMinChars", { count: MIN_PASSWORD_LENGTH }));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/shares/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.current, name: name.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 410) {
          setStatus("invalid");
        } else {
          setError(data.error || t("auth.genericError"));
        }
        return;
      }

      if (data.signedIn === false) {
        router.push("/login");
        return;
      }

      setStatus("done");
      router.push("/accounts");
    } catch {
      setError(t("auth.genericError"));
    } finally {
      setLoading(false);
    }
  }

  const loginRedirect = `/login?redirect=${encodeURIComponent(
    `/share-invite?token=${tokenParam}&lang=${locale}`,
  )}`;

  return (
    <AuthShell>
      {status === "loading" || sessionLoading ? (
        <p className="text-sm text-muted-foreground">{t("auth.loading")}</p>
      ) : status === "invalid" || !invite ? (
        <div className="space-y-6">
          <AuthHeading title={t("sharing.invite.title")} />
          <p className="text-muted-foreground">{t("sharing.invite.invalid")}</p>
          <Link href="/login" className={authSecondaryButtonClass}>
            {t("auth.backToSignIn")}
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Users className="h-3.5 w-3.5" />
            {t("sharing.invite.eyebrow")}
          </span>
          <AuthHeading
            title={
              invite.ownerName
                ? t("sharing.invite.titleFrom", {
                    owner: invite.ownerName,
                    account: invite.accountName,
                  })
                : t("sharing.invite.titleGeneric", { account: invite.accountName })
            }
            subtitle={t("sharing.invite.roleSubtitle", { role: t(ROLE_LABEL[invite.role]) })}
          />

          {session?.user ? (
            <div className="space-y-4">
              {error && <p className="text-sm text-destructive">{error}</p>}
              <button
                type="button"
                onClick={acceptAsLoggedIn}
                disabled={loading}
                className={authButtonClass}
              >
                {loading ? t("common.saving") : t("sharing.invite.accept")}
              </button>
            </div>
          ) : invite.userExists ? (
            <div className="space-y-4">
              <p className="text-muted-foreground">{t("sharing.invite.logInFirst")}</p>
              <Link href={loginRedirect} className={authButtonClass}>
                {t("auth.signIn")}
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSignupSubmit} className="space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none text-foreground">
                  {t("auth.email")}
                </label>
                <p className="text-sm text-muted-foreground">{invite.email}</p>
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
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={authInputClass}
                  placeholder={t("auth.displayNamePlaceholder")}
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
                  placeholder={t("auth.passwordMinChars", { count: MIN_PASSWORD_LENGTH })}
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <button type="submit" disabled={loading} className={authButtonClass}>
                {loading ? t("auth.creatingAccount") : t("sharing.invite.accept")}
              </button>
            </form>
          )}
        </div>
      )}
    </AuthShell>
  );
}
