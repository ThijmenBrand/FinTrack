"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import { SUB_LINE_ERROR_KEY } from "./constants";

/**
 * Inline error state for a sub-line row. There is no toast layer in this app,
 * so every action the row fires — save, and delete just as much as save —
 * routes its failure through here instead of an unhandled rejection.
 *
 * `pending` is per row rather than read off a shared mutation: the tree hands
 * every row the same action object, and one row saving must not spin the rest.
 */
export function useSubLineError() {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const capture = (e: unknown) => {
    const key = e instanceof ApiError && e.code ? SUB_LINE_ERROR_KEY[e.code] : undefined;
    setError(key ? t(key) : t("budgets.subLines.errGeneric"));
  };

  /** Runs an action, showing any failure on the row. Resolves true on success. */
  const guard = async (run: () => Promise<unknown> | void): Promise<boolean> => {
    setError(null);
    setPending(true);
    try {
      await run();
      return true;
    } catch (e) {
      capture(e);
      return false;
    } finally {
      setPending(false);
    }
  };

  return { error, setError, pending, guard };
}
