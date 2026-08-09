"use client";

import { useEffect, useState } from "react";
import { Download, Share, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "pwa-install-dismissed-at";
const DISMISS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos() {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
}

function isIosSafari() {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  // Other iOS browsers identify themselves: Chrome=CriOS, Firefox=FxiOS, Edge=EdgiOS, Opera=OPiOS
  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

function wasDismissedRecently() {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const ts = Number(raw);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < DISMISS_WINDOW_MS;
}

export function PwaInstallPrompt() {
  const { t } = useI18n();
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);

  useEffect(() => {
    if (isStandalone() || wasDismissedRecently()) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    if (isIos()) setShowIos(true);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    };
  }, []);

  const dismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setInstallEvent(null);
    setShowIos(false);
  };

  const handleInstall = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === "accepted" || outcome === "dismissed") {
      dismiss();
    }
  };

  if (installEvent) {
    return (
      <div className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-md rounded-lg border bg-card p-4 shadow-lg md:bottom-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Download className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">{t("pwa.install")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("pwa.installHint")}</p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={handleInstall}>
                {t("pwa.installButton")}
              </Button>
              <Button size="sm" variant="ghost" onClick={dismiss}>
                {t("pwa.notNow")}
              </Button>
            </div>
          </div>
          <button
            aria-label={t("pwa.dismiss")}
            className="text-muted-foreground transition-colors hover:text-foreground"
            onClick={dismiss}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  if (showIos) {
    const inSafari = isIosSafari();
    return (
      <div className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-md rounded-lg border bg-card p-4 shadow-lg md:bottom-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Share className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">{t("pwa.install")}</p>
            {inSafari ? (
              <ol className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                <li className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
                    1
                  </span>
                  <span className="flex items-center gap-1">
                    {t("pwa.iosStep1")}
                    <Share
                      aria-hidden
                      className="inline h-3.5 w-3.5 text-primary motion-safe:animate-pulse"
                    />
                    <span className="font-medium text-foreground">{t("pwa.iosShare")}</span>
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
                    2
                  </span>
                  <span className="flex items-center gap-1">
                    {t("pwa.iosStep2")}
                    <Plus aria-hidden className="inline h-3.5 w-3.5 text-primary" />
                    <span className="font-medium text-foreground">{t("pwa.iosAddToHome")}</span>
                  </span>
                </li>
              </ol>
            ) : (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("pwa.iosSafariPrefix")}{" "}
                <span className="font-medium text-foreground">Safari</span>,{" "}
                {t("pwa.iosSafariSuffix")}{" "}
                <Share className="inline h-3 w-3 align-text-bottom" /> {t("pwa.iosShare")} →{" "}
                <Plus className="inline h-3 w-3 align-text-bottom" /> {t("pwa.iosAddToHome")}.
              </p>
            )}
          </div>
          <button
            aria-label={t("pwa.dismiss")}
            className="text-muted-foreground transition-colors hover:text-foreground"
            onClick={dismiss}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return null;
}
