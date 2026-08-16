"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import { SUB_LINE_ERROR_KEY } from "./constants";

/**
 * Inline error state for a sub-line row. There is no toast layer in this app,
 * so every mutation the row fires — save, and delete just as much as save —
 * routes its failure through here instead of an unhandled rejection.
 */
export function useSubLineError() {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);

  const capture = (e: unknown) => {
    const key = e instanceof ApiError && e.code ? SUB_LINE_ERROR_KEY[e.code] : undefined;
    setError(key ? t(key) : t("budgets.subLines.errGeneric"));
  };

  /** Runs a mutation, showing any failure on the row. Resolves true on success. */
  const guard = async (run: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    try {
      await run();
      return true;
    } catch (e) {
      capture(e);
      return false;
    }
  };

  return { error, setError, guard };
}
