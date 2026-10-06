import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { readLockState, unlockMethods } from "@/lib/session-lock";
import { safeRedirectPath } from "@/lib/validation";
import { UnlockScreen } from "./unlock-screen";

/**
 * The idle-lock screen (src/lib/session-lock.ts). The proxy sends every
 * request of a locked session here; a session that isn't locked is sent
 * straight on, and no session at all goes to the sign-in page.
 */
export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string | string[] }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) redirect("/login");

  const isAdmin = (session.user as Record<string, unknown>).role === "admin";
  const home = isAdmin ? "/backoffice" : "/";
  const target = safeRedirectPath((await searchParams).redirect, home);
  const returnTo = target.startsWith("/unlock") ? home : target;

  const [lock, methods] = await Promise.all([
    readLockState(session.session.id),
    unlockMethods(session.user.id),
  ]);
  if (!lock.locked) redirect(returnTo);

  return (
    <UnlockScreen
      user={{
        name: session.user.name?.trim() || null,
        email: session.user.email,
        image: session.user.image ?? null,
      }}
      methods={methods}
      returnTo={returnTo}
      signInPath={isAdmin ? "/backoffice/login" : "/login"}
    />
  );
}
