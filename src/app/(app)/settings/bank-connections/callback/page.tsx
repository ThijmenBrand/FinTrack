"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import { bankErrorText, waitForRequest } from "@/hooks/use-bank-sync";

/**
 * Where the bank sends the user back (the redirect URL registered in their
 * Enable Banking application). The one-time code and state are read once and
 * wiped from the address bar before anything else happens, then handed to the
 * API — which checks the state belongs to this user and session.
 */
export default function BankCallbackPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const state = params.get("state") ?? "";
    const code = params.get("code") ?? "";
    const bankError = params.get("error") ?? "";
    // Out of the address bar and the history entry, before any await.
    window.history.replaceState(null, "", window.location.pathname);

    (async () => {
      try {
        const { requestId } = await apiFetch<{ requestId: string }>("/api/bank-sync/callback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state, code, error: bankError }),
        });
        const outcome = await waitForRequest(requestId);
        if (!outcome.ok) {
          setError(bankErrorText(t, outcome.errorCode));
          return;
        }
        router.replace("/settings/bank-connections");
      } catch (e) {
        setError(e instanceof Error ? e.message : t("common.somethingWentWrong"));
      }
    })();
  }, [router, t]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      {error ? (
        <>
          <TriangleAlert className="h-8 w-8 text-amber-500" />
          <p className="text-sm">{error}</p>
          <Button asChild variant="outline">
            <Link href="/settings/bank-connections">{t("bankSync.callback.back")}</Link>
          </Button>
        </>
      ) : (
        <>
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("bankSync.callback.finishing")}</p>
        </>
      )}
    </div>
  );
}
