"use client";

import { useState } from "react";
import { Fingerprint, Landmark, Loader2, ShieldCheck } from "lucide-react";
import { usePasskeys, useRegisterPasskey } from "@/hooks/use-passkey";
import { useSession } from "@/lib/auth-client";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n/client";
import { useIsHydrated, useMediaQuery } from "@/hooks/use-browser";

const DISMISS_KEY = "passkey-setup-dismissed";

/**
 * First-run nudge in the installed PWA: register a passkey so the hourly
 * session expiry costs one Face ID tap instead of an email and a password.
 * Shown once — "not now" is remembered, and the profile page keeps the
 * Passkey card for later.
 */
export function PasskeySetupScreen() {
  const { t } = useI18n();
  const { data: session, isPending: sessionLoading } = useSession();
  const queryClient = useQueryClient();

  // Detect if running as an installed PWA (standalone mode).
  const hydrated = useIsHydrated();
  const isStandalone =
    useMediaQuery("(display-mode: standalone)") ||
    (hydrated && (navigator as { standalone?: boolean }).standalone === true);
  const webAuthnSupported = hydrated && !!window.PublicKeyCredential;

  const { register: registerPasskey } = useRegisterPasskey();
  // Gated on the session too: this layout wraps /login, and the list endpoint
  // 401s without one — two failed requests on every visit to the sign-in page.
  const { data: passkeys, isPending: passkeysLoading } = usePasskeys(
    isStandalone && webAuthnSupported && !!session?.user,
  );

  const [dismissed, setDismissed] = useState(
    () => typeof window !== "undefined" && !!localStorage.getItem(DISMISS_KEY),
  );
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState("");

  // Don't show if: not standalone, no biometrics, still loading, no session,
  // already has a passkey, or already said no.
  if (!isStandalone || !webAuthnSupported) return null;
  if (sessionLoading || passkeysLoading) return null;
  if (!session?.user) return null;
  if (passkeys?.length) return null;
  if (dismissed) return null;

  async function handleRegister() {
    setError("");
    setRegistering(true);
    try {
      await registerPasskey();
      // The passkey query refetches and this screen dismisses itself.
      queryClient.invalidateQueries({ queryKey: ["passkeys"] });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("profile.passkey.registerFailed"),
      );
    } finally {
      setRegistering(false);
    }
  }

  function handleSkip() {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background p-4">
      {/* Soft primary glow for depth — static, decoration-free. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_35%,var(--primary),transparent)] opacity-[0.06]"
      />

      <div className="relative w-full max-w-sm">
        <div className="rounded-2xl border bg-card p-8 shadow-xl ring-1 ring-black/[0.04] dark:ring-white/[0.04]">
          <div className="mb-7 flex flex-col items-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md shadow-primary/25 ring-1 ring-inset ring-white/15">
              <Landmark className="h-7 w-7" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                {t("nav.appShortName")}
              </h1>
              <div className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4" />
                {t("passkeySetup.title")}
              </div>
              <p className="mx-auto max-w-[250px] text-xs text-muted-foreground">
                {t("passkeySetup.hint")}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {error && (
              <p className="text-center text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={handleRegister}
              disabled={registering}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-[background-color,transform] hover:bg-primary/90 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:pointer-events-none disabled:opacity-50"
            >
              {registering ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Fingerprint className="h-4 w-4" />
              )}
              {t("profile.passkey.setUp")}
            </button>

            <button
              type="button"
              onClick={handleSkip}
              className="w-full text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("passkeySetup.notNow")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
