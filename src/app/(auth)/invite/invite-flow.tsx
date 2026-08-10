"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Leaf, PartyPopper, Sparkles } from "lucide-react";
import { MIN_PASSWORD_LENGTH } from "@/lib/validation";
import { BANKS } from "@/lib/banks";
import { TOUR_PENDING_KEY } from "@/components/onboarding-tour";
import { useI18n } from "@/lib/i18n/client";
import {
  AuthShell,
  authButtonClass,
  authInputClass,
  authSecondaryButtonClass,
} from "../_components/auth-shell";

interface InviteInfo {
  email: string;
  displayName: string | null;
  invitedBy: string | null;
}

type Step = "welcome" | "account" | "mode" | "bank";

export default function InviteFlow() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const token = useRef("");
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [checked, setChecked] = useState(false);
  const [step, setStep] = useState<Step>("welcome");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [bankAccount, setBankAccount] = useState({ name: "", bank: "", balance: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // The root layout set <html lang> from Accept-Language; this page overrides
  // the locale, so keep the document tag honest for screen readers.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    // window.location instead of useSearchParams to avoid a Suspense boundary
    const t = new URLSearchParams(window.location.search).get("token") || "";
    token.current = t;
    (t
      ? fetch(`/api/invites/accept?token=${encodeURIComponent(t)}`)
          .then((r) => (r.ok ? (r.json() as Promise<InviteInfo>) : null))
          .catch(() => null)
      : Promise.resolve(null)
    )
      .then((data) => {
        setInvite(data);
        setDisplayName(data?.displayName || "");
      })
      .finally(() => setChecked(true));
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
      const res = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token.current,
          displayName: displayName.trim(),
          password,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || t("auth.inviteAcceptFailed"));
        return;
      }

      if (data.signedIn === false) {
        router.push("/login");
        return;
      }

      localStorage.setItem("lockscreen_username", invite!.email);
      localStorage.setItem("lockscreen_last_active", String(Date.now()));
      setStep("mode");
    } catch {
      setError(t("auth.genericError"));
    } finally {
      setLoading(false);
    }
  }

  async function chooseMode(simpleMode: boolean) {
    setLoading(true);
    // Best-effort: full mode is the server default, so a failed save still
    // lands the user in a working app.
    await fetch("/api/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ simpleMode }),
    }).catch(() => {});
    setLoading(false);
    setStep("bank");
  }

  function startTour() {
    localStorage.setItem(TOUR_PENDING_KEY, "1");
    router.push("/");
  }

  // ponytail: name + bank + starting balance only. Type is "checking" — the
  // sane default for a first account; Settings has the full form for the rest.
  async function createFirstAccount(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: bankAccount.name.trim(),
          type: "checking",
          bank: bankAccount.bank || null,
          initialBalance: parseFloat(bankAccount.balance) || 0,
        }),
      });
      if (!res.ok) {
        setError(t("auth.genericError"));
        return;
      }
      startTour();
    } catch {
      setError(t("auth.genericError"));
    } finally {
      setLoading(false);
    }
  }

  const firstName = (displayName || invite?.displayName || "")
    .trim()
    .split(/\s+/)[0];

  return (
    <AuthShell>
      {!checked ? (
        <p className="text-sm text-muted-foreground">{t("auth.loading")}</p>
      ) : !invite ? (
        <div className="space-y-6">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            {t("auth.inviteTitle")}
          </h1>
          <p className="text-muted-foreground">{t("auth.inviteInvalid")}</p>
          <Link
            href="/login"
            className={authSecondaryButtonClass}
          >
            {t("auth.backToSignIn")}
          </Link>
        </div>
      ) : step === "welcome" ? (
        <div className="space-y-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <PartyPopper className="h-3.5 w-3.5" />
            {t("auth.inviteEyebrow")}
          </span>
          <h1 className="text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            {firstName
              ? t("auth.inviteWelcomeTitle", {
                  name: firstName,
                  app: t("nav.appShortName"),
                })
              : t("auth.inviteWelcomeTitleNoName", {
                  app: t("nav.appShortName"),
                })}
          </h1>
          <p className="text-pretty text-lg leading-relaxed text-muted-foreground">
            {invite.invitedBy
              ? t("auth.inviteWelcomeInvitedBy", { inviter: invite.invitedBy })
              : t("auth.inviteWelcomeBody")}
          </p>
          <button
            type="button"
            onClick={() => setStep("account")}
            className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-8 text-base font-medium text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:bg-primary/90 hover:shadow-xl hover:shadow-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:w-auto"
          >
            {t("auth.inviteGetStarted")}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>
      ) : step === "mode" ? (
        <div className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              {t("auth.modeTitle")}
            </h1>
            <p className="text-muted-foreground">{t("auth.modeSubtitle")}</p>
          </div>
          <div className="space-y-3">
            {[
              {
                icon: Leaf,
                title: t("auth.modeEasyTitle"),
                body: t("auth.modeEasyBody"),
                simple: true,
              },
              {
                icon: Sparkles,
                title: t("auth.modeFullTitle"),
                body: t("auth.modeFullBody"),
                simple: false,
              },
            ].map(({ icon: Icon, title, body, simple }) => (
              <button
                key={title}
                type="button"
                disabled={loading}
                onClick={() => chooseMode(simple)}
                className="flex w-full items-start gap-4 rounded-xl border border-input bg-card p-5 text-left shadow-sm transition-all hover:border-primary hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </span>
                <span>
                  <span className="block font-medium text-foreground">
                    {title}
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {body}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : step === "bank" ? (
        <form onSubmit={createFirstAccount} className="space-y-5">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              {t("auth.firstAccountTitle")}
            </h1>
            <p className="text-muted-foreground">{t("auth.firstAccountSubtitle")}</p>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="accountName"
              className="text-sm font-medium leading-none text-foreground"
            >
              {t("accounts.nameLabel")}
            </label>
            <input
              id="accountName"
              type="text"
              autoComplete="off"
              autoFocus
              required
              value={bankAccount.name}
              onChange={(e) =>
                setBankAccount((a) => ({ ...a, name: e.target.value }))
              }
              className={authInputClass}
              placeholder={t("accounts.namePlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="accountBank"
              className="text-sm font-medium leading-none text-foreground"
            >
              {t("accounts.bankLabel")}
            </label>
            <select
              id="accountBank"
              value={bankAccount.bank}
              onChange={(e) =>
                setBankAccount((a) => ({ ...a, bank: e.target.value }))
              }
              className={authInputClass}
            >
              <option value="">{t("accounts.bankNotSet")}</option>
              {/* "Other" needs a free-text name field; Settings covers that case. */}
              {BANKS.filter((b) => b.value !== "other").map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="accountBalance"
              className="text-sm font-medium leading-none text-foreground"
            >
              {t("accounts.startingBalanceLabel")}
            </label>
            <input
              id="accountBalance"
              type="number"
              step="0.01"
              inputMode="decimal"
              value={bankAccount.balance}
              onChange={(e) =>
                setBankAccount((a) => ({ ...a, balance: e.target.value }))
              }
              className={authInputClass}
              placeholder="0.00"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={loading || !bankAccount.name.trim()}
            className={authButtonClass}
          >
            {loading ? t("common.saving") : t("accounts.createAccount")}
          </button>

          <button
            type="button"
            onClick={startTour}
            className="w-full text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            {t("auth.firstAccountSkip")}
          </button>
        </form>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              {t("auth.inviteSetUp")}
            </h1>
            <p className="text-muted-foreground">
              {t("auth.inviteSetUpSubtitle")}
            </p>
          </div>
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
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
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
        </form>
      )}
    </AuthShell>
  );
}
