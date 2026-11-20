/** Route match key for /api/auth/*. Trailing slashes are stripped so no guard
 *  built on it is one `/` away from being skipped, and the path is decoded
 *  first: `URL.pathname` leaves `%2F` and friends encoded, so
 *  `/two-factor%2Fdisable` would slip past an `endsWith` check here while the
 *  catch-all route below still resolves it to the disable handler. */
export function routePath(url: string): string {
  const raw = new URL(url).pathname;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Malformed escape — match on the raw path rather than throwing; a path
    // that cannot be decoded cannot route anywhere either.
  }
  return decoded.replace(/\/+$/, "");
}

/**
 * Better Auth gives an administrator two ways to clear the flag that guards the
 * backoffice: POST /two-factor/disable, and the admin plugin's
 * /admin/update-user, whose `data` is an unvalidated bag of user columns.
 *
 * `disable` still needs a role check at the call site — only admins are locked
 * in. Writing the column through update-user is refused for everyone: nothing
 * in the backoffice does it, and forcing the flag *on* is its own lockout,
 * since it grants no verified secret to sign in with.
 */
export function twoFactorEscapeHatch(
  path: string,
  body: unknown,
): "disable" | "update-user" | null {
  if (path.endsWith("/two-factor/disable")) return "disable";
  if (path.endsWith("/admin/update-user")) {
    const data = (body as { data?: unknown } | null)?.data;
    if (data && typeof data === "object" && "twoFactorEnabled" in data) {
      return "update-user";
    }
  }
  return null;
}
