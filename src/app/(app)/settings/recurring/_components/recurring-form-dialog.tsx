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
import { Plus } from "lucide-react";
import type { Account, CategoryWithDetails, RecurringTx } from "@/types/api";

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function RecurringFormDialog({
  open,
  onOpenChange,
  editing,
  accounts,
  categories,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: RecurringTx | null;
  accounts: Account[];
  categories: CategoryWithDetails[];
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Recurring
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {/* Remount on open/edit-target change so fields re-derive from `editing` without an effect. */}
        {open && (
          <RecurringFormBody
            key={editing?.id ?? "new"}
            editing={editing}
            accounts={accounts}
            categories={categories}
            onSubmit={onSubmit}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RecurringFormBody({
  editing,
  accounts,
  categories,
  onSubmit,
  onCancel,
}: {
  editing: RecurringTx | null;
  accounts: Account[];
  categories: CategoryWithDetails[];
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [fAccountId, setFAccountId] = useState(editing?.accountId ?? "");
  const [fDescription, setFDescription] = useState(editing?.description ?? "");
  const [fAmount, setFAmount] = useState(
    editing ? String(Math.abs(editing.amount)) : ""
  );
  const [fType, setFType] = useState<"income" | "expense">(
    (editing?.type as "income" | "expense") ?? "expense"
  );
  const [fCategoryId, setFCategoryId] = useState(editing?.categoryId ?? "");
  const [fFrequency, setFFrequency] = useState(editing?.frequency ?? "monthly");
  const [fDayOfWeek, setFDayOfWeek] = useState(String(editing?.dayOfWeek ?? 1));
  const [fDayOfMonth, setFDayOfMonth] = useState(
    String(editing?.dayOfMonth ?? 1)
  );
  const [fStartDate, setFStartDate] = useState(
    editing?.startDate ?? new Date().toISOString().slice(0, 10)
  );
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const amount = parseFloat(fAmount);
    if (!amount || !fAccountId || !fDescription || submitting) return;

    setSubmitting(true);
    try {
      await onSubmit({
        accountId: fAccountId,
        description: fDescription,
        amount,
        type: fType,
        categoryId: fCategoryId || null,
        frequency: fFrequency,
        dayOfWeek: fFrequency === "weekly" ? parseInt(fDayOfWeek) : null,
        dayOfMonth:
          fFrequency === "monthly" || fFrequency === "yearly"
            ? parseInt(fDayOfMonth)
            : null,
        startDate: fStartDate,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {editing ? "Edit Recurring Payment" : "Add Recurring Payment"}
        </DialogTitle>
        <DialogDescription>
          {editing
            ? "Update this recurring income or expense."
            : "Set up a recurring income or expense for cash flow tracking."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label>Type</Label>
            <Select
              value={fType}
              onValueChange={(v) => setFType(v as "income" | "expense")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Expense</SelectItem>
                <SelectItem value="income">Income</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Account</Label>
            <Select value={fAccountId} onValueChange={setFAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-2">
          <Label>Description</Label>
          <Input
            placeholder="e.g. Rent, Salary, Netflix"
            value={fDescription}
            onChange={(e) => setFDescription(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label>Amount</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                &euro;
              </span>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={fAmount}
                onChange={(e) => setFAmount(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Category</Label>
            <Select value={fCategoryId} onValueChange={setFCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Optional..." />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{
                          backgroundColor: c.color || "#94a3b8",
                        }}
                      />
                      {c.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label>Frequency</Label>
            <Select value={fFrequency} onValueChange={setFFrequency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="biweekly">Bi-weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="yearly">Yearly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {fFrequency === "weekly" && (
            <div className="grid gap-2">
              <Label>Day of week</Label>
              <Select value={fDayOfWeek} onValueChange={setFDayOfWeek}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOW_LABELS.map((label, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {(fFrequency === "monthly" || fFrequency === "yearly") && (
            <div className="grid gap-2">
              <Label>Day of month</Label>
              <Input
                type="number"
                min="1"
                max="31"
                value={fDayOfMonth}
                onChange={(e) => setFDayOfMonth(e.target.value)}
              />
            </div>
          )}
        </div>
        <div className="grid gap-2">
          <Label>Start date</Label>
          <Input
            type="date"
            value={fStartDate}
            onChange={(e) => setFStartDate(e.target.value)}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!fAccountId || !fDescription || !fAmount || submitting}
        >
          {editing ? "Save Changes" : "Create"}
        </Button>
      </DialogFooter>
    </>
  );
}
