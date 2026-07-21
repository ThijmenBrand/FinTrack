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
import { MATCH_TYPES } from "./match-types";

interface RuleDialogProps {
  categories: CategoryWithDetails[];
}

export function RuleDialog({ categories }: RuleDialogProps) {
  const createRule = useCreateCategoryRule();

  const [open, setOpen] = useState(false);
  const [pattern, setPattern] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [matchType, setMatchType] = useState("contains");
  const [applyExisting] = useState(true);
  const [result, setResult] = useState<string | null>(null);

  const reset = () => {
    setPattern("");
    setCategoryId("");
    setMatchType("contains");
    setResult(null);
  };

  const handleSubmit = async () => {
    const data = await createRule.mutateAsync({
      pattern,
      categoryId,
      matchType,
      applyToExisting: applyExisting,
    });
    if (data.applied && data.applied > 0) {
      setResult(
        `Rule created and applied to ${data.applied} existing transaction${data.applied !== 1 ? "s" : ""}`
      );
    } else {
      setResult("Rule created. It will apply to future CSV imports.");
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
          <span className="hidden sm:inline">Add Rule</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Categorization Rule</DialogTitle>
          <DialogDescription>
            Automatically categorize transactions matching a pattern.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Pattern to match</Label>
            <Input
              placeholder='e.g. "Albert Heijn", "PayPal", "ASML"'
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Match type</Label>
            <Select value={matchType} onValueChange={setMatchType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MATCH_TYPES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Assign to category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a category..." />
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
            {result ? "Close" : "Cancel"}
          </Button>
          {!result && (
            <Button onClick={handleSubmit} disabled={!pattern || !categoryId}>
              Create Rule
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
