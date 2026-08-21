"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check } from "lucide-react";
import { useCreateSplitRule } from "@/hooks/use-transactions";
import { extractPattern } from "@/lib/csv-utils";
import { MATCH_TYPES, MATCH_FIELDS } from "@/lib/match-types";
import { useI18n } from "@/lib/i18n/client";
import { buildRuleLines, type SplitRow } from "./split-rows";

/** Inline "split future transactions like this" follow-up — shown once after a manual split. */
export function SplitRulePrompt({
  rows,
  totalCents,
  parentDescription,
  onDone,
}: {
  rows: SplitRow[];
  totalCents: number;
  parentDescription: string;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pattern, setPattern] = useState(extractPattern(parentDescription));
  const [matchType, setMatchType] = useState("contains");
  const [matchField, setMatchField] = useState("both");
  const [mode, setMode] = useState<"percentage" | "fixed">("percentage");
  const [applyToExisting, setApplyToExisting] = useState(false);
  const createRule = useCreateSplitRule();
  const allCategorized = rows.every((r) => r.categoryId);

  const submit = () => {
    createRule.mutate(
      {
        pattern,
        matchType,
        matchField,
        mode,
        lines: buildRuleLines(rows, mode, totalCents),
        applyToExisting,
      },
      { onSuccess: onDone, onError: (err) => console.error("Failed to create split rule:", err) },
    );
  };

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-start gap-2">
        <Checkbox
          id="split-create-rule"
          checked={open}
          onCheckedChange={(checked) => setOpen(checked === true)}
          className="mt-0.5"
        />
        <div>
          <Label htmlFor="split-create-rule" className="text-sm font-medium cursor-pointer">
            {t("tx.split.ruleCheckbox")}
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5">{t("categorize.applyToAllHint")}</p>
        </div>
      </div>

      {open && (
        <div className="space-y-2 pl-6">
          <div className="space-y-1">
            <Label className="text-xs">{t("categorize.matchPattern")}</Label>
            <Input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder={t("categorize.patternPlaceholder")}
              className="h-8 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">{t("categorize.matchField")}</Label>
              <Select value={matchField} onValueChange={setMatchField}>
                <SelectTrigger className="h-8 text-sm">
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
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("categorize.matchType")}</Label>
              <Select value={matchType} onValueChange={setMatchType}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATCH_TYPES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {t(m.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("tx.split.ruleMode")}</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as "percentage" | "fixed")}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentage">{t("tx.split.ruleModePercentage")}</SelectItem>
                <SelectItem value="fixed">{t("tx.split.ruleModeFixed")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-start gap-2 pt-1">
            <Checkbox
              id="split-apply-existing"
              checked={applyToExisting}
              onCheckedChange={(checked) => setApplyToExisting(checked === true)}
              className="mt-0.5"
            />
            <Label htmlFor="split-apply-existing" className="text-xs font-normal cursor-pointer">
              {t("tx.split.ruleApplyExisting")}
            </Label>
          </div>
          {!allCategorized ? (
            <p className="text-xs text-destructive">{t("tx.split.ruleNeedsCategories")}</p>
          ) : (
            <div className="flex justify-end">
              <Button size="sm" onClick={submit} disabled={createRule.isPending || !pattern.trim()}>
                {createRule.isPending ? t("tx.split.ruleSaving") : t("tx.split.ruleSave")}
                {!createRule.isPending && <Check className="ml-1 h-3 w-3" />}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
