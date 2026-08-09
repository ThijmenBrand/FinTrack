import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { TwoFactorCard } from "@/app/(app)/profile/_components/two-factor-card";
import { BackofficeSignOut } from "@/app/backoffice/(protected)/_components/sign-out-button";

export default async function BackofficeSecurityPage() {
  const [session, { t }] = await Promise.all([requireAuth(), getI18n()]);
  if (!session.isAdmin) redirect("/");
  if (session.twoFactorEnabled) redirect("/backoffice");

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-2xl"><div className="mb-6 text-center"><h1 className="text-2xl font-bold tracking-tight">{t("backoffice.securityTitle")}</h1><p className="mt-2 text-muted-foreground">{t("backoffice.securityBody")}</p></div><TwoFactorCard enabled={false} required redirectTo="/backoffice" />
        {/* Every other route is closed to this admin until 2FA is on, so this
            is their only way back out — e.g. to sign in on a device that has
            their authenticator. */}
        <div className="mt-6 flex justify-center"><BackofficeSignOut /></div></div>
    </main>
  );
}
