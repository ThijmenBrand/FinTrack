"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Repeat, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUndoLearnedRule } from "@/hooks/use-recurring";
import { useI18n } from "@/lib/i18n/client";
import {
  dismissLearnedRule,
  getLearnedRule,
  subscribeLearnedRule,
} from "@/lib/learned-rule-notice";

/** Long enough to read and reach Undo; the rule stays editable on the plan. */
const VISIBLE_MS = 10_000;

/**
 * Says what a first link taught a plan — the rule and how many past payments
 * it linked — with Undo, so a rule that reaches too far costs one click.
 */
export function LearnedRuleNotice() {
  const { t, plural } = useI18n();
  const learned = useSyncExternalStore(subscribeLearnedRule, getLearnedRule, () => null);
  const undo = useUndoLearnedRule();
  const busy = undo.isPending;
  const failed = undo.isError;

  useEffect(() => {
    if (!learned || busy || failed) return;
    const timer = setTimeout(dismissLearnedRule, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [learned, busy, failed]);

  // A new notice starts without the last one's error.
  const { reset } = undo;
  useEffect(() => reset(), [learned, reset]);

  if (!learned) return null;

  const message =
    learned.linkedIds.length > 0
      ? plural(learned.linkedIds.length, "recurringLink.learned.one", "recurringLink.learned.other", {
          pattern: learned.pattern,
        })
      : t("recurringLink.learnedNone", { pattern: learned.pattern });

  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-md rounded-lg border bg-card p-3 shadow-lg md:bottom-6"
    >
      <div className="flex items-center gap-3">
        <Repeat className="h-4 w-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 text-sm">
          {failed ? t("recurringLink.undoFailed") : message}
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => undo.mutate(learned, { onSuccess: dismissLearnedRule })}
        >
          {t("recurringLink.undo")}
        </Button>
        <button
          aria-label={t("recurringLink.dismiss")}
          className="text-muted-foreground transition-colors hover:text-foreground"
          onClick={dismissLearnedRule}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
