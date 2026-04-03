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
import { Tag, Check, X } from "lucide-react";

interface Category {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
}

interface CategorizePopoverProps {
  transactionId: string;
  transactionDescription: string;
  currentCategoryId: string | null;
  currentCategoryName: string | null;
  currentCategoryColor: string | null;
  categories: Category[];
  onCategorized: () => void;
}

export function CategorizePopover({
  transactionId,
  transactionDescription,
  currentCategoryId,
  currentCategoryName,
  currentCategoryColor,
  categories,
  onCategorized,
}: CategorizePopoverProps) {
  const [open, setOpen] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState(
    currentCategoryId || ""
  );
  const [createRule, setCreateRule] = useState(false);
  const [rulePattern, setRulePattern] = useState("");
  const [ruleMatchType, setRuleMatchType] = useState("contains");
  const [saving, setSaving] = useState(false);

  // Extract a sensible default pattern from the description
  useEffect(() => {
    if (open && transactionDescription) {
      // Try to extract the merchant name from typical bank descriptions
      // E.g. "AH Strijp 8616 >EINDHOVEN25.02.2026..." → "AH Strijp"
      // E.g. "PayPal Europe S.a.r.l..." → "PayPal"
      const desc = transactionDescription;

      // For BEA (card) transactions: get text before ">"
      const beforeArrow = desc.split(">")[0]?.trim();
      if (beforeArrow && beforeArrow.length < desc.length) {
        // Remove trailing numbers/spaces (store IDs)
        const cleaned = beforeArrow.replace(/\s+\d+\s*$/, "").trim();
        setRulePattern(cleaned || beforeArrow);
      } else {
        // Take first 2-3 meaningful words
        const words = desc.split(/\s+/).slice(0, 3).join(" ");
        setRulePattern(words);
      }
    }
  }, [open, transactionDescription]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch("/api/transactions/categorize", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId,
          categoryId: selectedCategoryId || null,
          createRule,
          rulePattern: createRule ? rulePattern : undefined,
          ruleMatchType: createRule ? ruleMatchType : undefined,
        }),
      });
      setOpen(false);
      onCategorized();
    } catch (err) {
      console.error("Failed to categorize:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 text-sm rounded-md px-2 py-1 hover:bg-accent transition-colors text-left">
          {currentCategoryName ? (
            <>
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{
                  backgroundColor: currentCategoryColor || "#94a3b8",
                }}
              />
              <span className="truncate">{currentCategoryName}</span>
            </>
          ) : (
            <span className="text-muted-foreground flex items-center gap-1">
              <Tag className="h-3 w-3" />
              Categorize
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-4">
          <div>
            <h4 className="font-medium text-sm mb-1">Set Category</h4>
            <p className="text-xs text-muted-foreground truncate">
              {transactionDescription}
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Category</Label>
            <Select
              value={selectedCategoryId}
              onValueChange={setSelectedCategoryId}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select a category..." />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{
                          backgroundColor: cat.color || "#94a3b8",
                        }}
                      />
                      {cat.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                  Apply to all matching transactions
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Creates a rule for future CSV imports too
                </p>
              </div>
            </div>

            {createRule && (
              <div className="space-y-2 pl-6">
                <div className="space-y-1">
                  <Label className="text-xs">Match pattern</Label>
                  <Input
                    value={rulePattern}
                    onChange={(e) => setRulePattern(e.target.value)}
                    placeholder="e.g. Starbucks"
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Match type</Label>
                  <Select
                    value={ruleMatchType}
                    onValueChange={setRuleMatchType}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contains">
                        Description contains
                      </SelectItem>
                      <SelectItem value="starts_with">
                        Description starts with
                      </SelectItem>
                      <SelectItem value="exact">
                        Exact match
                      </SelectItem>
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
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || !selectedCategoryId}
            >
              {saving ? "Saving..." : "Save"}
              {!saving && <Check className="ml-1 h-3 w-3" />}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
