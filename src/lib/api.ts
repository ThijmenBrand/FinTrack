import { SESSION_LOCKED_CODE, unlockPath } from "@/lib/unlock-path";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Stable machine-readable reason, when the endpoint sends one. The
     *  `message` is an English fallback; `code` is what the UI translates. */
    public code?: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (body.code === SESSION_LOCKED_CODE) goToLockScreen();
    throw new ApiError(res.status, body.error || res.statusText, body.code);
  }
  return res.json();
}

/**
 * The session locked while this page sat open (see src/lib/session-lock.ts).
 * A full load, so nothing rendered from before the lock stays on screen.
 */
export function goToLockScreen() {
  if (typeof window === "undefined" || window.location.pathname === "/unlock") return;
  const { pathname, search } = window.location;
  window.location.assign(unlockPath(pathname + search));
}
