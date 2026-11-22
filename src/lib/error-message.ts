import { ApiError } from "@/lib/api";
import type { I18n, MessageKey } from "@/lib/i18n/translate";

export interface ErrorMessage {
  title: string;
  description?: string;
}

/**
 * `t` returns the key itself when it isn't in the catalogue, which is how we
 * tell an endpoint's i18n key (`pots.budget.err.sumMismatch`) apart from its
 * English developer string ("accountId is required").
 */
function translated(t: I18n["t"], candidate: string | undefined): string | undefined {
  if (!candidate) return undefined;
  const text = t(candidate as MessageKey);
  return text === candidate ? undefined : text;
}

/**
 * Turns whatever a mutation or query threw into something worth showing a
 * person: what happened, and what they can do about it. Status codes carry
 * most of the meaning — a 409 is a different conversation from a 500 — so the
 * mapping is by status first, and only falls back to the server's own wording
 * when it is a message we actually wrote for humans.
 */
export function describeError(error: unknown, t: I18n["t"]): ErrorMessage {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { title: t("err.offline.title"), description: t("err.offline.body") };
  }

  if (error instanceof ApiError) {
    // An endpoint's own translated message beats a generic one — it knows
    // which rule was broken.
    const specific = translated(t, error.code) ?? translated(t, error.message);
    if (specific) return { title: specific };

    switch (true) {
      case error.status === 401:
        return { title: t("err.signedOut.title"), description: t("err.signedOut.body") };
      case error.status === 403:
        return { title: t("err.forbidden.title") };
      case error.status === 404:
        return { title: t("err.notFound.title"), description: t("err.notFound.body") };
      case error.status === 409:
        return { title: t("err.conflict.title"), description: error.message };
      case error.status === 429:
        return { title: t("err.tooMany.title"), description: t("err.tooMany.body") };
      case error.status >= 500:
        return { title: t("err.server.title"), description: t("err.server.body") };
      default:
        // A 4xx we wrote but didn't translate. The raw line is terse, but it
        // names the actual problem, which beats "something went wrong".
        return { title: t("err.generic.title"), description: error.message };
    }
  }

  // fetch() rejects with a TypeError when the request never left the device.
  if (error instanceof TypeError) {
    return { title: t("err.network.title"), description: t("err.network.body") };
  }

  return {
    title: t("err.generic.title"),
    description: error instanceof Error ? error.message : undefined,
  };
}
