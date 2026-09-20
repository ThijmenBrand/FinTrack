"use client";

/**
 * THESIS: Your profile is a spec sheet, not a stack of forms. It was the last
 *   page still built the way settings used to be — five same-size cards, each
 *   led by a `bg-primary/10` icon medallion, each ending in its own Save button
 *   — so nothing could be scanned and nothing agreed with /settings.
 * OWN-WORLD: Borrows the settings system wholesale: one bordered panel per
 *   topic, a muted header band naming it, hairline-divided rows inside, every
 *   control on a shared right rail. Identity autosaves like any other setting;
 *   the three security flows open in dialogs, because a multi-step enrolment is
 *   a task, not a preference.
 * STORY: You land, see who you are and what protects the account in one screen,
 *   change the one thing you came for, and leave.
 * FIRST VIEWPORT: "Profile" h1 and its one-line purpose, then Account — face,
 *   name, email, role, member since — then Sign-in & security with the state of
 *   each protection stated before the button that changes it.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useProfile } from "@/hooks/use-profile";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import { AccountPanel } from "./_components/account-panel";
import { SecurityPanel } from "./_components/security-panel";
import { PasskeysPanel } from "./_components/passkeys-panel";

export default function ProfilePage() {
  const { t } = useI18n();
  const router = useRouter();
  const { data: profile, isLoading, error } = useProfile();

  // Redirect on 401
  useEffect(() => {
    if (error && (error as ApiError).status === 401) router.push("/login");
  }, [error, router]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile) return null;

  return (
    // Bounded like the settings tabs: a row is label-left/control-right, and on
    // a wide monitor an unbounded row puts metres of nothing between the two.
    <div className="max-w-3xl space-y-6">
      <div className="space-y-1">
        {/* Matches the settings layout's heading, down to the weight — the two
            pages are the same surface reached from two places. */}
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("profile.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("profile.subtitle")}</p>
      </div>

      <AccountPanel profile={profile} />
      <SecurityPanel twoFactorEnabled={profile.twoFactorEnabled} />
      <PasskeysPanel />
    </div>
  );
}
