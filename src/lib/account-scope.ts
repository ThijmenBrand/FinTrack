/**
 * The accounts the dashboard and Insights default to: everyday money, i.e.
 * every checking account. Falls back to the user's single default-account
 * preference when there are no checking accounts, and to "all accounts"
 * (empty list) when there is neither.
 */
export function defaultScopeAccountIds(
  accounts: { id: string; type: string }[],
  defaultAccountId?: string | null,
): string[] {
  const checking = accounts.filter((a) => a.type === "checking").map((a) => a.id);
  if (checking.length > 0) return checking;
  return defaultAccountId ? [defaultAccountId] : [];
}
