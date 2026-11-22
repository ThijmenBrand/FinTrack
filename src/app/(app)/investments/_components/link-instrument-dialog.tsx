"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch, ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";

/**
 * Point one holding at a provider listing, so its price stops being typed.
 *
 * The search is behind a button and runs once per press. It costs a call from
 * a budget of twenty a day, which is also why the remaining count comes back
 * with the results and is shown plainly: the limit is low enough that a person
 * should be able to see it coming rather than discover it.
 *
 * The query is editable and pre-filled with the ISIN. Searching the ISIN is
 * right almost every time, but when it is not — a fund the provider files
 * under a different code — a fixed query would be a dead end with no way out
 * but entering prices by hand forever.
 *
 * The listing is chosen, never guessed. The same UCITS fund trades in
 * Amsterdam in euros, in London in dollars and in London again in pence; this
 * app converts no currencies, so a wrong pick does not fail, it silently
 * restates the portfolio. The foreign ones are therefore called out in the
 * list and then confirmed separately, because the cost of that misclick is a
 * net worth that is wrong by a factor of eighty and still looks plausible.
 */

interface Listing {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  isin: string | null;
  previousClose: number | null;
}

export function LinkInstrumentDialog({
  instrumentId,
  name,
  isin,
}: {
  instrumentId: string;
  name: string;
  isin: string | null;
}) {
  const { t } = useI18n();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(isin ?? name);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [confirming, setConfirming] = useState<Listing | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState<MessageKey | string | null>(null);

  async function search() {
    setBusy(true);
    setError(null);
    try {
      const data = await apiFetch<{ listings: Listing[]; remaining: number }>(
        `/api/instruments/search?q=${encodeURIComponent(query.trim())}`,
      );
      setListings(data.listings);
      setRemaining(data.remaining);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "investments.lookup.failed");
    } finally {
      setBusy(false);
    }
  }

  /** Euro listings link straight away; anything else has to be confirmed. */
  function choose(listing: Listing) {
    if (listing.currency === "EUR") void link(listing);
    else setConfirming(listing);
  }

  async function link(listing: Listing) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/instruments/${instrumentId}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: listing.symbol, currency: listing.currency }),
      });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "investments.lookup.failed");
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  }

  function openDialog() {
    setQuery(isin ?? name);
    setListings(null);
    setConfirming(null);
    setRemaining(null);
    setError(null);
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        <Link2 className="h-3 w-3" aria-hidden="true" />
        {t("investments.lookup.action")}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {confirming ? t("investments.lookup.confirmTitle") : name}
            </DialogTitle>
            <DialogDescription>
              {confirming
                ? t("investments.lookup.confirmBody", {
                    symbol: confirming.symbol,
                    currency: confirming.currency,
                  })
                : t("investments.lookup.hint")}
            </DialogDescription>
          </DialogHeader>

          {confirming ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setConfirming(null)}
              >
                {t("common.back")}
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => void link(confirming)}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("investments.lookup.confirmAction")}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor={`lookup-${instrumentId}`}>
                  {t("investments.lookup.queryLabel")}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id={`lookup-${instrumentId}`}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter searches, because a form here would submit the
                      // page; a call only ever leaves on a deliberate press.
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (!busy && query.trim().length >= 2) void search();
                      }
                    }}
                    maxLength={80}
                  />
                  <Button
                    onClick={search}
                    disabled={busy || query.trim().length < 2}
                  >
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    {busy
                      ? t("investments.lookup.searching")
                      : t("investments.lookup.action")}
                  </Button>
                </div>
              </div>

              {listings !== null &&
                (listings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("investments.lookup.none")}
                  </p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">
                      {t("investments.lookup.pick")}
                    </p>
                    <ul className="space-y-1.5">
                      {listings.map((l) => (
                        <li key={l.symbol}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => choose(l)}
                            className="flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left hover:bg-muted disabled:opacity-50"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium">
                                {l.name}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {l.symbol} · {l.exchange} · {l.currency}
                                {/* The last close, so the figure can be
                                    checked against the broker before
                                    committing. One ISIN can list six ways —
                                    euros here, dollars there, pence somewhere
                                    else — and the number is the fastest way to
                                    tell which one you hold. */}
                                {l.previousClose !== null && ` · ${l.previousClose}`}
                              </span>
                            </span>
                            {l.currency !== "EUR" && (
                              <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">
                                {t("investments.lookup.currencyWarning", {
                                  currency: l.currency,
                                })}
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          )}

          {remaining !== null && !confirming && (
            <p className="text-xs text-muted-foreground">
              {t("investments.lookup.remaining", { count: remaining })}
            </p>
          )}
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {/* An ApiError already arrives translated; a bare key does not. */}
              {error.includes(".") && !error.includes(" ")
                ? t(error as MessageKey)
                : error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
