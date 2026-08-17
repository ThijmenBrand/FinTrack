"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Zap } from "lucide-react";
import { useCreateCategoryRule } from "@/hooks/use-categories";
import type { CategoryWithDetails } from "@/types/api";
import { MATCH_TYPES, MATCH_FIELDS } from "@/lib/match-types";
import { useI18n } from "@/lib/i18n/client";

interface RuleDialogProps {
  categories: CategoryWithDetails[];
}

export function RuleDialog({ categories }: RuleDialogProps) {
  const { t, plural } = useI18n();
  const createRule = useCreateCategoryRule();

  const [open, setOpen] = useState(false);
  const [pattern, setPattern] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [matchType, setMatchType] = useState("contains");
  const [matchField, setMatchField] = useState("both");
  const [applyExisting] = useState(true);
  const [result, setResult] = useState<string | null>(null);

  const reset = () => {
    setPattern("");
    setCategoryId("");
    setMatchType("contains");
    setMatchField("both");
    setResult(null);
  };

  const handleSubmit = async () => {
    const data = await createRule.mutateAsync({
      pattern,
      categoryId,
      matchType,
      matchField,
      applyToExisting: applyExisting,
    });
    if (data.applied && data.applied > 0) {
      setResult(
        plural(
          data.applied,
          "categories.rule.appliedResult.one",
          "categories.rule.appliedResult.other",
        ),
      );
    } else {
      setResult(t("categories.rule.futureResult"));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Zap className="sm:mr-2 h-4 w-4" />
          <span className="hidden sm:inline">{t("categories.rule.add")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("categories.rule.title")}</DialogTitle>
          <DialogDescription>{t("categories.rule.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>{t("categories.rule.patternLabel")}</Label>
            <Input
              placeholder={t("categories.rule.patternPlaceholder")}
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
            />
          </div>
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
            <Label>{t("categories.rule.categoryLabel")}</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder={t("categories.rule.categoryPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: cat.color || "#94a3b8" }}
                      />
                      {cat.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {result && <div className="rounded-md bg-muted p-3 text-sm">{result}</div>}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setOpen(false);
              reset();
            }}
          >
            {result ? t("common.close") : t("common.cancel")}
          </Button>
          {!result && (
            <Button onClick={handleSubmit} disabled={!pattern || !categoryId}>
              {t("categories.rule.create")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
