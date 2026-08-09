"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";
import { useI18n } from "@/lib/i18n/client";

export function BackofficeSignOut() {
  const { t } = useI18n();
  const router = useRouter();

  return (
    <button
      onClick={async () => {
        await signOut();
        router.push("/backoffice/login");
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <LogOut className="h-3.5 w-3.5" />
      {t("backoffice.signOut")}
    </button>
  );
}
