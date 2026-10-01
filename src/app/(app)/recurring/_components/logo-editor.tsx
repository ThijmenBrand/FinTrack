"use client";

import { useState } from "react";
import { Loader2, Pencil, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useRemoveRecurringLogo, useSetRecurringLogo } from "@/hooks/use-recurring";
import { useI18n } from "@/lib/i18n/client";
import type { RecurringTx } from "@/types/api";
import { PlanLogo } from "./plan-logo";

/**
 * The detail header's logo, which opens a picker when the user can edit the
 * plan. One field takes whatever the user has to hand — the company's site, a
 * direct link to a logo, or just a name — and the server works out which.
 */
export function LogoEditor({
  plan,
  color,
  canEdit,
  className,
}: {
  plan: RecurringTx;
  color: string;
  canEdit: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const setLogo = useSetRecurringLogo();
  const removeLogo = useRemoveRecurringLogo();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("");

  const logo = <PlanLogo name={plan.description} logoUrl={plan.logoUrl} color={color} className={className} />;
  if (!canEdit) return logo;

  const busy = setLogo.isPending || removeLogo.isPending;
  // Which of the two find buttons is spinning.
  const findingTyped = setLogo.isPending && !!setLogo.variables?.source;
  const findingByName = setLogo.isPending && !setLogo.variables?.source;
  const error = setLogo.error ?? removeLogo.error;

  // Nothing awaits these, so failures are caught here; `error` tells the user.
  const find = async (input?: string) => {
    removeLogo.reset();
    try {
      await setLogo.mutateAsync({ id: plan.id, source: input });
      setSource("");
      setOpen(false);
    } catch (err) {
      console.error("Failed to set recurring logo:", err);
    }
  };
  const remove = async () => {
    setLogo.reset();
    try {
      await removeLogo.mutateAsync(plan.id);
      setOpen(false);
    } catch (err) {
      console.error("Failed to remove recurring logo:", err);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setLogo.reset();
          removeLogo.reset();
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("recurring.logo.change")}
          title={t("recurring.logo.change")}
          className="group relative shrink-0 rounded-[28%] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {logo}
          <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <Pencil className="h-2.5 w-2.5" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="flex items-center gap-3">
          <PlanLogo name={plan.description} logoUrl={plan.logoUrl} color={color} className="h-10 w-10 text-base" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t("recurring.logo.title")}</p>
            <p className="truncate text-xs text-muted-foreground" title={plan.logoSource ?? undefined}>
              {plan.logoUrl && plan.logoSource
                ? t("recurring.logo.from", { source: plan.logoSource })
                : plan.logoPending
                  ? t("recurring.logo.searching")
                  : t("recurring.logo.none")}
            </p>
          </div>
        </div>

        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (source.trim()) find(source.trim());
          }}
        >
          <Input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="hbomax.com"
            aria-label={t("recurring.logo.inputLabel")}
            maxLength={2000}
            autoFocus
          />
          <Button type="submit" size="sm" className="h-9" disabled={!source.trim() || busy}>
            {findingTyped && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("recurring.logo.use")}
          </Button>
        </form>
        <p className="mt-1.5 text-[11px] text-muted-foreground">{t("recurring.logo.inputLabel")}</p>

        {error && <p className="mt-2 text-xs text-destructive">{error.message}</p>}

        <div className="mt-3 flex items-center gap-1 border-t pt-3">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => find()}>
            {findingByName ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            {t("recurring.logo.auto")}
          </Button>
          {plan.logoUrl && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-muted-foreground"
              disabled={busy}
              onClick={remove}
            >
              {removeLogo.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("recurring.logo.remove")}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
