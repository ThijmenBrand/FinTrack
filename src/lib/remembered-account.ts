/**
 * The account last signed in on this device, so the login page can skip the
 * email step and go straight to the password (or a passkey tap).
 *
 * Only what the sign-in form already shows is kept — the email and a display
 * name. Never a password, token or anything a signed-out visitor couldn't
 * learn by typing the email themselves. "Not you?" on the login page forgets it.
 */

export const REMEMBERED_ACCOUNT_KEY = "remembered-account-v1";

export type SignInMethod = "password" | "passkey";

export interface RememberedAccount {
  email: string;
  name: string | null;
  /** How the last sign-in happened — a passkey user isn't handed a keyboard. */
  method: SignInMethod;
}

/** Parse a stored value, rejecting anything malformed or hand-edited. */
export function parseRememberedAccount(
  raw: string | null,
): RememberedAccount | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { email, name, method } = value as Record<string, unknown>;
  if (typeof email !== "string" || !email.includes("@") || email.length > 320) {
    return null;
  }
  return {
    email,
    name: typeof name === "string" && name.trim() ? name.trim().slice(0, 100) : null,
    method: method === "passkey" ? "passkey" : "password",
  };
}

/** First word of the display name, for "Welcome back, Thijmen". */
export function firstName(name: string | null): string | null {
  return name?.trim().split(/\s+/)[0] || null;
}

// Same-tab writes don't fire `storage`, so subscribers are told directly.
const listeners = new Set<() => void>();

export function subscribeRememberedAccount(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function readRememberedAccountRaw(): string | null {
  try {
    return window.localStorage.getItem(REMEMBERED_ACCOUNT_KEY);
  } catch {
    // Storage blocked (private mode, enterprise policy) — just don't remember.
    return null;
  }
}

function write(update: (storage: Storage) => void) {
  try {
    update(window.localStorage);
  } catch {
    return;
  }
  listeners.forEach((l) => l());
}

export function rememberAccount(account: {
  email: string;
  name?: string | null;
  method: SignInMethod;
}) {
  const value: RememberedAccount = {
    email: account.email.trim(),
    name: account.name?.trim() || null,
    method: account.method,
  };
  write((s) => s.setItem(REMEMBERED_ACCOUNT_KEY, JSON.stringify(value)));
}

export function forgetRememberedAccount() {
  write((s) => s.removeItem(REMEMBERED_ACCOUNT_KEY));
}
