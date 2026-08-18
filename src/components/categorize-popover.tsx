"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tag, Check } from "lucide-react";
import { extractPattern } from "@/lib/csv-utils";
import { MATCH_TYPES, MATCH_FIELDS } from "@/lib/match-types";
import { CategoryIcon } from "@/components/category-icon";
import { CategorySelect } from "@/components/category-select";
import { useCategorizeTransaction } from "@/hooks/use-transactions";
import type { Category } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";

interface CategorizePopoverProps {
  transactionId: string;
  transactionDescription: string;
  currentCategoryId: string | null;
  currentCategoryName: string | null;
  currentCategoryColor: string | null;
  currentCategoryIcon?: string | null;
  categories: Category[];
  onCategorized?: (categoryId?: string | null) => void;
}

export function CategorizePopover({
  transactionId,
  transactionDescription,
  currentCategoryId,
  currentCategoryName,
  currentCategoryColor,
  currentCategoryIcon,
  categories,
  onCategorized,
}: CategorizePopoverProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState(
    currentCategoryId || ""
  );
  const [createRule, setCreateRule] = useState(false);
  const [rulePattern, setRulePattern] = useState("");
  const [ruleMatchType, setRuleMatchType] = useState("contains");
  const [ruleMatchField, setRuleMatchField] = useState("both");
  const categorize = useCategorizeTransaction();

  // Extract a sensible default pattern from the description
  useEffect(() => {
    if (open && transactionDescription) {
      setRulePattern(extractPattern(transactionDescription));
    }
  }, [open, transactionDescription]);

  const handleSave = () => {
    setOpen(false);
    onCategorized?.(selectedCategoryId || null);
    categorize.mutate(
      {
        transactionId,
        categoryId: selectedCategoryId || null,
        createRule,
        rulePattern: createRule ? rulePattern : undefined,
        ruleMatchType: createRule ? ruleMatchType : undefined,
        ruleMatchField: createRule ? ruleMatchField : undefined,
      },
      {
        onError: (err) => {
          console.error("Failed to categorize:", err);
        },
      }
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          data-tour="tx-category"
          className="flex items-center gap-1.5 text-sm rounded-md px-2 py-1 hover:bg-accent transition-colors text-left"
        >
          {currentCategoryName ? (
            <>
              <CategoryIcon icon={currentCategoryIcon ?? null} color={currentCategoryColor} size="sm" />
              <span className="truncate">{currentCategoryName}</span>
            </>
          ) : (
            <span className="text-muted-foreground flex items-center gap-1">
              <Tag className="h-3 w-3" />
              {t("categorize.trigger")}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-4">
          <div>
            <h4 className="font-medium text-sm mb-1">{t("categorize.title")}</h4>
            <p className="text-xs text-muted-foreground break-words">
              {transactionDescription}
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">{t("common.category")}</Label>
            <CategorySelect
              value={selectedCategoryId}
              onValueChange={setSelectedCategoryId}
              categories={categories}
            />
          </div>

          {/* Create Rule Checkbox */}
          <div className="rounded-md border p-3 space-y-3">
            <div className="flex items-start gap-2">
              <Checkbox
                id="create-rule"
                checked={createRule}
                onCheckedChange={(checked) =>
                  setCreateRule(checked === true)
                }
                className="mt-0.5"
              />
              <div>
                <Label htmlFor="create-rule" className="text-sm font-medium cursor-pointer">
                  {t("categorize.applyToAll")}
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("categorize.applyToAllHint")}
                </p>
              </div>
            </div>

            {createRule && (
              <div className="space-y-2 pl-6">
                <div className="space-y-1">
                  <Label className="text-xs">{t("categorize.matchPattern")}</Label>
                  <Input
                    value={rulePattern}
                    onChange={(e) => setRulePattern(e.target.value)}
                    placeholder={t("categorize.patternPlaceholder")}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("categorize.matchField")}</Label>
                  <Select value={ruleMatchField} onValueChange={setRuleMatchField}>
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
                  <Select
                    value={ruleMatchType}
                    onValueChange={setRuleMatchType}
                  >
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
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={categorize.isPending || !selectedCategoryId}
            >
              {categorize.isPending ? t("categorize.saving") : t("common.save")}
              {!categorize.isPending && <Check className="ml-1 h-3 w-3" />}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
