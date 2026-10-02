"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { BankSyncStatus } from "@/lib/bank-sync/status";
import type { I18n, MessageKey } from "@/lib/i18n/translate";
import { isJobErrorCode } from "@/lib/jobs/types";

export type { BankSyncStatus };
export type BankConnectionView = BankSyncStatus["connections"][number];
export type BankLinkView = BankConnectionView["links"][number];

export const BANK_SYNC_KEY = ["bank-sync"] as const;

/** Everything on the bank-connections screen. Polls quickly while the worker is busy for us. */
export function useBankSyncStatus(enabled = true) {
  return useQuery({
    queryKey: BANK_SYNC_KEY,
    queryFn: () => apiFetch<BankSyncStatus>("/api/bank-sync/status"),
    enabled,
    refetchInterval: (query) => {
      const s = query.state.data;
      if (!s) return false;
      const busy =
        !!s.pendingCredentialJob ||
        s.credential?.status === "verifying" ||
        s.connections.some((c) => c.disconnecting || c.links.some((l) => l.syncing));
      return busy ? 2_000 : 60_000;
    },
  });
}

export interface RequestOutcome<T = unknown> {
  ok: boolean;
  result: T | null;
  errorCode: string | null;
}

/**
 * Wait for a queued job to finish. The worker polls interactive jobs every
 * second; give it a generous minute (a 4096-bit key takes a moment).
 */
export async function waitForRequest<T = unknown>(requestId: string, timeoutMs = 60_000): Promise<RequestOutcome<T>> {
  const until = Date.now() + timeoutMs;
  let delay = 500;
  while (Date.now() < until) {
    const r = await apiFetch<{ done: boolean; ok: boolean; result: T | null; errorCode: string | null }>(
      `/api/bank-sync/requests/${encodeURIComponent(requestId)}`,
    );
    if (r.done) return { ok: r.ok, result: r.result, errorCode: r.errorCode };
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.5, 2_000);
  }
  return { ok: false, result: null, errorCode: "timeout" };
}

/** A stored error code as a sentence the user can act on. */
export function bankErrorText(t: I18n["t"], code: string | null | undefined): string {
  if (!code) return "";
  const key = `bankSync.error.${isJobErrorCode(code) ? code : "internal"}` as MessageKey;
  return t(key);
}

/** "just now", "12 min ago", "3 h ago", or a date. */
export function syncedAgo(i18n: Pick<I18n, "t" | "formatDate">, iso: string | null): string {
  if (!iso) return i18n.t("bankSync.never");
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 2) return i18n.t("bankSync.justNow");
  if (minutes < 60) return i18n.t("bankSync.minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return i18n.t("bankSync.hoursAgo", { count: hours });
  return i18n.formatDate(iso);
}

/** The current time, refreshed every minute — for "ends soon" checks during render. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
