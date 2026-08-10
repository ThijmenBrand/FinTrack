import { isLocale } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n/client";
import InviteFlow from "./invite-flow";

/**
 * The invitee has no account and no stored preference yet, so the root layout
 * can only guess from Accept-Language. The invite link carries the inviter's
 * locale in `?lang=`; overriding the provider here renders the whole onboarding
 * flow in that language from the first paint — no flash, no client fetch.
 */
export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const { lang } = await searchParams;
  if (!isLocale(lang)) return <InviteFlow />;

  return (
    <I18nProvider locale={lang}>
      <InviteFlow />
    </I18nProvider>
  );
}
