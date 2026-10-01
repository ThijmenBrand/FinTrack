"use client";

import { useState } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpdateRecurring } from "@/hooks/use-recurring";
import { MATCH_FIELDS, MATCH_FIELD_LABEL_KEYS } from "@/lib/match-types";
import { useI18n } from "@/lib/i18n/client";
import type { RecurringTx } from "@/types/api";

/**
 * The plan's auto-link rule: what it is, and a way to change it. The rule is
 * normally learned from the first payment linked by hand, so the empty state
 * says that rather than asking for one up front.
 */
export function MatchRuleEditor({ plan, canEdit }: { plan: RecurringTx; canEdit: boolean }) {
  const { t, plural } = useI18n();
  const update = useUpdateRecurring();
  const [editing, setEditing] = useState(false);
  const [pattern, setPattern] = useState("");
  const [field, setField] = useState("name");
  // What the last save did to history — said once, then gone on the next edit.
  const [linked, setLinked] = useState<number | null>(null);

  const startEdit = () => {
    setPattern(plan.matchPattern ?? plan.description);
    setField(plan.matchField);
    setLinked(null);
    update.reset();
    setEditing(true);
  };

  // Nothing awaits the click, so a failure is caught here; `update.isError`
  // is what tells the user.
  const save = async (next: { matchPattern: string | null; matchField?: string }) => {
    try {
      const res = (await update.mutateAsync({ id: plan.id, ...next })) as { linked?: number };
      setLinked(next.matchPattern ? (res.linked ?? 0) : null);
      setEditing(false);
    } catch (err) {
      console.error("Failed to save recurring match rule:", err);
    }
  };

  const fieldLabel = t(MATCH_FIELD_LABEL_KEYS[plan.matchField] ?? MATCH_FIELD_LABEL_KEYS.name);

  return (
    <section className="mt-6 rounded-lg border bg-card p-4">
      {/* The actions wrap under the text on a phone rather than squeezing it. */}
      <div className="flex flex-wrap items-start gap-3">
        <Wand2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 basis-60">
          <h2 className="text-sm font-semibold">{t("recurring.rule.title")}</h2>

          {!editing && (
            <p className="mt-1 text-sm text-muted-foreground">
              {plan.matchPattern
                ? t("recurring.rule.active", { field: fieldLabel.toLowerCase(), pattern: plan.matchPattern })
                : t("recurring.rule.none")}
            </p>
          )}
          {!editing && linked !== null && (
            <p className="mt-1 text-xs text-muted-foreground">
              {linked > 0
                ? plural(linked, "recurring.rule.linked.one", "recurring.rule.linked.other")
                : t("recurring.rule.linkedNone")}
            </p>
          )}

          {editing && (
            <form
              className="mt-3 flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (pattern.trim()) save({ matchPattern: pattern.trim(), matchField: field });
              }}
            >
              <Select value={field} onValueChange={setField}>
                <SelectTrigger className="w-auto min-w-36" aria-label={t("categories.rule.matchFieldLabel")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATCH_FIELDS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {t(f.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">{t("recurring.rule.contains")}</span>
              <Input
                className="min-w-48 flex-1"
                value={pattern}
                maxLength={200}
                onChange={(e) => setPattern(e.target.value)}
                aria-label={t("categories.rule.patternLabel")}
                autoFocus
              />
              <Button type="submit" size="sm" disabled={!pattern.trim() || update.isPending}>
                {update.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t("common.save")}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
                {t("common.cancel")}
              </Button>
            </form>
          )}
          {update.isError && (
            <p className="mt-2 text-xs text-destructive">{t("recurring.rule.saveFailed")}</p>
          )}
        </div>

        {canEdit && !editing && (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {plan.matchPattern && (
              <Button
                variant="ghost"
                size="sm"
                disabled={update.isPending}
                onClick={() => save({ matchPattern: null })}
              >
                {t("recurring.rule.clear")}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={startEdit}>
              {plan.matchPattern ? t("common.edit") : t("recurring.rule.set")}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
