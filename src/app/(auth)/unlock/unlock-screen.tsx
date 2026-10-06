"use client";

import { useRef, useState } from "react";
import { Fingerprint, Loader2, Lock } from "lucide-react";
import { startAuthentication } from "@simplewebauthn/browser";
import { apiFetch, ApiError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { useI18n } from "@/lib/i18n/client";
import type { UnlockMethods } from "@/lib/session-lock";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import {
  AuthHeading,
  AuthShell,
  authButtonClass,
  authInputClass,
  authSecondaryButtonClass,
} from "../_components/auth-shell";

type Busy = "passkey" | "password" | "signout" | null;

const linkButtonClass =
  "rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

export function UnlockScreen({
  user,
  methods,
  returnTo,
  signInPath,
}: {
  user: { name: string | null; email: string; image: string | null };
  methods: UnlockMethods;
  returnTo: string;
  signInPath: string;
}) {
  const { t } = useI18n();
  // A passkey is one tap; the password form stays folded away behind it.
  const [showPassword, setShowPassword] = useState(!methods.passkey);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  // A ref, not state — see the login page: a second tap during the options
  // fetch would start a second ceremony and the browser aborts the first.
  const ceremonyRunning = useRef(false);

  const firstName = user.name?.split(/\s+/)[0];
  const canUnlock = !signedOut && (methods.passkey || methods.password);

  // A full load, not router.push: the WebAuthn sheet backgrounds the page, and
  // a client transition started as it comes back can be dropped in the PWA.
  const proceed = () => window.location.assign(returnTo);

  const describe = (e: unknown) =>
    e instanceof ApiError || e instanceof Error ? e.message : t("common.somethingWentWrong");

  async function unlockWithPasskey() {
    // One fetch, and no render, between the tap and the ceremony — WebKit
    // spends the user activation on anything more and the sheet never opens.
    if (ceremonyRunning.current) return;
    ceremonyRunning.current = true;
    try {
      const optionsJSON = await apiFetch<
        Parameters<typeof startAuthentication>[0]["optionsJSON"]
      >("/api/unlock/passkey/options", { method: "POST" });
      const response = await startAuthentication({ optionsJSON });
      setError("");
      setBusy("passkey");
      await apiFetch("/api/unlock/passkey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      proceed();
    } catch (e) {
      setBusy(null);
      setError(
        e instanceof Error && e.name === "NotAllowedError"
          ? t("unlock.cancelled")
          : describe(e),
      );
    } finally {
      ceremonyRunning.current = false;
    }
  }

  async function unlockWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy("password");
    try {
      await apiFetch("/api/unlock/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      proceed();
    } catch (err) {
      setBusy(null);
      setPassword("");
      if (err instanceof ApiError && err.code === "signed_out") setSignedOut(true);
      else setError(describe(err));
    }
  }

  async function signOut(then: string = signInPath) {
    setBusy("signout");
    await authClient.signOut().catch(() => {});
    window.location.assign(then);
  }

  const passkeyLabel =
    busy === "passkey" ? (
      <>
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("unlock.unlocking")}
      </>
    ) : (
      <>
        <Fingerprint className="h-5 w-5" />
        {t("unlock.withBiometrics")}
      </>
    );

  const errorLine = error && (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  );

  let body: React.ReactNode;
  if (!canUnlock) {
    body = (
      <div className="space-y-5">
        {signedOut && (
          <p role="alert" className="text-sm text-destructive">
            {t("unlock.signedOut")}
          </p>
        )}
        <button
          type="button"
          onClick={() => signOut()}
          disabled={busy !== null}
          className={authButtonClass}
        >
          {busy === "signout" && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("unlock.signInAgain")}
        </button>
      </div>
    );
  } else if (!showPassword) {
    body = (
      <div className="space-y-5">
        <button
          type="button"
          onClick={unlockWithPasskey}
          disabled={busy !== null}
          className={authButtonClass}
        >
          {passkeyLabel}
        </button>
        {errorLine}
        {methods.password && (
          <p className="text-center">
            <button
              type="button"
              onClick={() => {
                setError("");
                setShowPassword(true);
              }}
              disabled={busy !== null}
              className={linkButtonClass}
            >
              {t("unlock.usePassword")}
            </button>
          </p>
        )}
      </div>
    );
  } else {
    body = (
      <form onSubmit={unlockWithPassword} className="space-y-5">
        {/* Pairs the saved password with this account for the password
            manager — the email itself is only shown, not typed. */}
        <input
          type="email"
          name="username"
          autoComplete="username"
          value={user.email}
          readOnly
          hidden
        />
        <div className="space-y-2">
          <label
            htmlFor="unlock-password"
            className="text-sm font-medium leading-none text-foreground"
          >
            {t("auth.password")}
          </label>
          <input
            id="unlock-password"
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

        {errorLine}

        <button
          type="submit"
          disabled={busy !== null || !password}
          className={authButtonClass}
        >
          {busy === "password" && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy === "password" ? t("unlock.unlocking") : t("unlock.unlock")}
        </button>

        {methods.passkey && (
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
              onClick={unlockWithPasskey}
              disabled={busy !== null}
              className={cn(authSecondaryButtonClass, "sm:w-full")}
            >
              {passkeyLabel}
            </button>
          </>
        )}

        <p>
          <button
            type="button"
            onClick={() => signOut("/forgot-password")}
            disabled={busy !== null}
            className={linkButtonClass}
          >
            {t("auth.forgotPassword")}
          </button>
        </p>
      </form>
    );
  }

  return (
    <AuthShell>
      <div className="space-y-6">
        <AuthHeading
          title={firstName ? t("unlock.titleName", { name: firstName }) : t("unlock.title")}
          subtitle={canUnlock ? t("unlock.subtitle") : t("unlock.subtitleSignIn")}
        />

        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-sm">
          <span className="relative shrink-0">
            <UserAvatar
              name={user.name ?? user.email}
              image={user.image}
              className="h-11 w-11 text-base"
            />
            <span
              title={t("unlock.locked")}
              className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-card"
            >
              <Lock className="h-3 w-3" aria-hidden />
              <span className="sr-only">{t("unlock.locked")}</span>
            </span>
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {user.name ?? user.email}
            </p>
            {user.name && (
              <p className="truncate text-sm text-muted-foreground">{user.email}</p>
            )}
          </div>
          {!signedOut && (
            <button
              type="button"
              onClick={() => signOut()}
              disabled={busy !== null}
              className="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {t("unlock.signOut")}
            </button>
          )}
        </div>

        {body}

        {canUnlock && !methods.passkey && (
          <div className="flex items-start gap-3 rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Fingerprint className="h-4 w-4" aria-hidden />
            </span>
            <p className="pt-1.5">{t("unlock.passkeyHint")}</p>
          </div>
        )}
      </div>
    </AuthShell>
  );
}
