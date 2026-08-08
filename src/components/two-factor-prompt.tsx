"use client";

import Link from "next/link";
import { ShieldCheck, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { authClient } from "@/lib/auth-client";

const DISMISS_KEY = "two_factor_prompt_dismissed";

function subscribeToDismissal(callback: () => void) {
  window.addEventListener("two-factor-prompt-dismissed", callback);
  return () => window.removeEventListener("two-factor-prompt-dismissed", callback);
}

export function TwoFactorPrompt() {
  const { data: session, isPending } = authClient.useSession();
  const dismissed = useSyncExternalStore(
    subscribeToDismissal,
    () => sessionStorage.getItem(DISMISS_KEY) === "1",
    () => true,
  );

  if (isPending || dismissed || session?.user.twoFactorEnabled) return null;

  return (
    <div className="mb-5 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1"><p className="font-medium">Protect your account with two-factor authentication</p><p className="mt-1 text-muted-foreground">Use an authenticator app to add a second layer of security when you sign in.</p><Link href="/profile#two-factor-authentication" className="mt-2 inline-block font-medium text-primary hover:underline">Set up two-factor authentication</Link></div>
      <button aria-label="Dismiss two-factor authentication reminder" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => { sessionStorage.setItem(DISMISS_KEY, "1"); window.dispatchEvent(new Event("two-factor-prompt-dismissed")); }}><X className="h-4 w-4" /></button>
    </div>
  );
}
