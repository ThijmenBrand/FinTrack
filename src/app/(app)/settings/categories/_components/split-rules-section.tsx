"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { Pencil, Plus, Minus, Split } from "lucide-react";
import { useSplitRules, useUpdateSplitRule, useDeleteSplitRule } from "@/hooks/use-categories";
import { useCreateSplitRule, type SplitRuleLineInput } from "@/hooks/use-transactions";
import {
  MATCH_TYPES,
  MATCH_TYPE_LABEL_KEYS,
  MATCH_FIELDS,
  MATCH_FIELD_LABEL_KEYS,
} from "@/lib/match-types";
import type { CategoryWithDetails, SplitRuleWithLines } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";

type Mode = "percentage" | "fixed";

/** One line as edited in the dialog — the value is a raw input string. */
interface LineDraft {
  key: string;
  categoryId: string;
  value: string;
}

let lineSeq = 0;
const newLine = (categoryId = "", value = ""): LineDraft => ({
  key: `l${++lineSeq}`,
  categoryId,
  value,
});

const num = (raw: string) => Number(raw.replace(",", "."));

/**
 * Draft lines → API lines. Fixed mode follows the same convention as the
 * transactions-page rule prompt: the LAST line is the remainder, so the user
 * never has to make the amounts add up exactly.
 */
function toApiLines(lines: LineDraft[], mode: Mode): SplitRuleLineInput[] {
  return lines.map((line, i) => {
    const last = i === lines.length - 1;
    if (mode === "fixed") {
      return last
        ? { categoryId: line.categoryId, sortOrder: i, isRemainder: true }
        : { categoryId: line.categoryId, sortOrder: i, amount: num(line.value) };
    }
    return { categoryId: line.categoryId, sortOrder: i, percentage: num(line.value) };
  });
}

function linesFromRule(rule: SplitRuleWithLines): LineDraft[] {
  return rule.lines.map((line) =>
    newLine(
      line.categoryId,
      line.isRemainder
        ? ""
        : String(rule.mode === "percentage" ? line.percentage ?? "" : line.amount ?? ""),
    ),
  );
}

function SplitRuleDialog({
  rule,
  categories,
  open,
  onOpenChange,
}: {
  /** Null when creating. */
  rule: SplitRuleWithLines | null;
  categories: CategoryWithDetails[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, plural } = useI18n();
  const createRule = useCreateSplitRule();
  const updateRule = useUpdateSplitRule();

  const [pattern, setPattern] = useState(rule?.pattern ?? "");
  const [matchType, setMatchType] = useState(rule?.matchType ?? "contains");
  const [matchField, setMatchField] = useState(rule?.matchField ?? "both");
  const [mode, setMode] = useState<Mode>(rule?.mode ?? "percentage");
  const [lines, setLines] = useState<LineDraft[]>(
    rule ? linesFromRule(rule) : [newLine(), newLine()],
  );
  const [applyToExisting, setApplyToExisting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const percentTotal = lines.reduce((sum, l) => sum + (num(l.value) || 0), 0);
  const allCategorized = lines.every((l) => l.categoryId);
  // Percentage lines must total 100; in fixed mode every line but the
  // remainder needs a positive amount.
  const valuesValid =
    mode === "percentage"
      ? Math.abs(percentTotal - 100) < 0.01 && lines.every((l) => num(l.value) > 0)
      : lines.slice(0, -1).every((l) => num(l.value) > 0);
  const canSave = !!pattern.trim() && lines.length >= 2 && allCategorized && valuesValid;
  const pending = createRule.isPending || updateRule.isPending;

  const submit = async () => {
    setError(null);
    const payload = {
      pattern,
      matchType,
      matchField,
      mode,
      lines: toApiLines(lines, mode),
      applyToExisting,
    };
    try {
      const data = rule
        ? await updateRule.mutateAsync({ id: rule.id, ...payload })
        : await createRule.mutateAsync(payload);
      setResult(
        data.applied
          ? plural(data.applied, "splitRules.appliedResult.one", "splitRules.appliedResult.other")
          : t("splitRules.futureResult"),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule ? t("splitRules.editTitle") : t("splitRules.createTitle")}</DialogTitle>
          <DialogDescription>{t("splitRules.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>{t("categories.rule.patternLabel")}</Label>
            <Input
              placeholder={t("categories.rule.patternPlaceholder")}
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label>{t("categories.rule.matchFieldLabel")}</Label>
              <Select value={matchField} onValueChange={setMatchField}>
                <SelectTrigger>
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
            <div className="grid gap-2">
              <Label>{t("categories.rule.matchTypeLabel")}</Label>
              <Select value={matchType} onValueChange={setMatchType}>
                <SelectTrigger>
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
            <div className="grid gap-2">
              <Label>{t("tx.split.ruleMode")}</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">{t("tx.split.ruleModePercentage")}</SelectItem>
                  <SelectItem value="fixed">{t("tx.split.ruleModeFixed")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>{t("splitRules.linesLabel")}</Label>
            {lines.map((line, i) => {
              const isRemainder = mode === "fixed" && i === lines.length - 1;
              return (
                <div key={line.key} className="flex items-center gap-2">
                  <Select
                    value={line.categoryId}
                    onValueChange={(v) => updateLine(line.key, { categoryId: v })}
                  >
                    <SelectTrigger className="h-8 flex-1 text-sm">
                      <SelectValue placeholder={t("categories.rule.categoryPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="flex items-center gap-2">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: c.color || "#94a3b8" }}
                            />
                            {c.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {isRemainder ? (
                    <span className="w-24 shrink-0 text-xs text-muted-foreground">
                      {t("splitRules.remainder")}
                    </span>
                  ) : (
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={line.value}
                      onChange={(e) => updateLine(line.key, { value: e.target.value })}
                      placeholder={mode === "percentage" ? "%" : "0.00"}
                      className="h-8 w-24 shrink-0 text-sm"
                    />
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground"
                    disabled={lines.length <= 2}
                    aria-label={t("tx.split.removePart")}
                    onClick={() =>
                      setLines((prev) =>
                        prev.length > 2 ? prev.filter((l) => l.key !== line.key) : prev,
                      )
                    }
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLines((prev) => [...prev, newLine()])}
              >
                <Plus className="h-3.5 w-3.5" />
                {t("tx.split.addPart")}
              </Button>
              {mode === "percentage" && (
                <span
                  className={`text-xs ${valuesValid ? "text-muted-foreground" : "text-destructive"}`}
                >
                  {t("splitRules.percentTotal", { total: Math.round(percentTotal * 100) / 100 })}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="split-rule-apply-existing"
              checked={applyToExisting}
              onCheckedChange={(checked) => setApplyToExisting(checked === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor="split-rule-apply-existing"
              className="cursor-pointer text-xs font-normal"
            >
              {t("tx.split.ruleApplyExisting")}
            </Label>
          </div>

          {result && <div className="rounded-md bg-muted p-3 text-sm">{result}</div>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {result ? t("common.close") : t("common.cancel")}
          </Button>
          {!result && (
            <Button onClick={submit} disabled={!canSave || pending}>
              {pending ? t("categorize.saving") : t("common.save")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A rule's lines, one per row: category dot + name + its share. */
function RuleLines({ rule }: { rule: SplitRuleWithLines }) {
  const { t, formatCurrency } = useI18n();
  return (
    <div className="space-y-1">
      {rule.lines.map((line) => (
        <div key={line.id} className="flex items-center gap-2 text-xs">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: line.categoryColor || "#94a3b8" }}
          />
          <span className="min-w-0 flex-1 truncate">
            {line.categoryName ?? t("csvReview.unknownCategory")}
          </span>
          <span className="shrink-0 font-mono text-muted-foreground">
            {line.isRemainder
              ? t("splitRules.remainder")
              : rule.mode === "percentage"
                ? `${line.percentage ?? 0}%`
                : formatCurrency(line.amount ?? 0)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** "Split rules" management, alongside the category rules on this page. */
export function SplitRulesSection({ categories }: { categories: CategoryWithDetails[] }) {
  const { t } = useI18n();
  const { data: rules = [] } = useSplitRules();
  const deleteRule = useDeleteSplitRule();
  const [editing, setEditing] = useState<SplitRuleWithLines | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const openDialog = (rule: SplitRuleWithLines | null) => {
    setEditing(rule);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <Split className="h-4 w-4 text-muted-foreground" />
          {t("splitRules.heading", { count: rules.length })}
        </h3>
        <Button variant="outline" size="sm" onClick={() => openDialog(null)}>
          <Plus className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">{t("splitRules.add")}</span>
        </Button>
      </div>

      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("splitRules.empty")}</p>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <Card key={rule.id} className="space-y-2 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="truncate font-mono text-sm">&quot;{rule.pattern}&quot;</span>
                <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
                  {MATCH_FIELD_LABEL_KEYS[rule.matchField]
                    ? t(MATCH_FIELD_LABEL_KEYS[rule.matchField])
                    : rule.matchField}
                  {" · "}
                  {MATCH_TYPE_LABEL_KEYS[rule.matchType]
                    ? t(MATCH_TYPE_LABEL_KEYS[rule.matchType])
                    : rule.matchType}
                  {" · "}
                  {rule.mode === "percentage"
                    ? t("tx.split.ruleModePercentage")
                    : t("tx.split.ruleModeFixed")}
                </Badge>
                <div className="ml-auto flex shrink-0 gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    aria-label={t("splitRules.editTitle")}
                    onClick={() => openDialog(rule)}
                  >
                    <Pencil className="h-3 w-3 text-muted-foreground" />
                  </Button>
                  <ConfirmDeleteButton
                    onConfirm={async () => {
                      await deleteRule.mutateAsync(rule.id);
                    }}
                    pending={deleteRule.isPending}
                    label={t("splitRules.delete")}
                  />
                </div>
              </div>
              <RuleLines rule={rule} />
            </Card>
          ))}
        </div>
      )}

      {dialogOpen && (
        <SplitRuleDialog
          // Remounted per rule so the draft state starts from that rule.
          key={editing?.id ?? "new"}
          rule={editing}
          categories={categories}
          open
          onOpenChange={(next) => {
            setDialogOpen(next);
            if (!next) setEditing(null);
          }}
        />
      )}
    </div>
  );
}
