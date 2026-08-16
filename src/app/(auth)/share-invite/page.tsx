import { isLocale } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n/client";
import ShareInviteFlow from "./share-invite-flow";

/**
 * Same reasoning as /invite: the invite link carries the owner's locale in
 * `?lang=`, so the page renders in it from the first paint instead of
 * guessing from Accept-Language.
 */
export default async function ShareInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const { lang } = await searchParams;
  if (!isLocale(lang)) return <ShareInviteFlow />;

  return (
    <I18nProvider locale={lang}>
      <ShareInviteFlow />
    </I18nProvider>
  );
}
