"use client";

import { useEffect, useState, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Landmark,
  Plus,
  Pencil,
  Trash2,
  MoreVertical,
  GripVertical,
  Wallet,
} from "lucide-react";

interface Account {
  id: string;
  name: string;
  type: string;
  bankName: string | null;
  iban: string | null;
  currency: string;
  initialBalance: number;
  currentBalance: number;
  transactionTotal: number;
  createdAt: string;
  updatedAt: string;
}

const ACCOUNT_TYPES = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  { value: "joint", label: "Joint" },
  { value: "credit", label: "Credit Card" },
  { value: "other", label: "Other" },
];

function formatCurrency(amount: number, currency = "EUR") {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency,
  }).format(amount);
}

const ACCOUNT_TYPE_COLORS: Record<string, string> = {
  checking: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  savings: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
  joint: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-800",
  credit: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800",
  other: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800",
};

const ACCOUNT_ICON_BG: Record<string, string> = {
  checking: "bg-blue-600 text-white dark:bg-blue-500",
  savings: "bg-emerald-600 text-white dark:bg-emerald-500",
  joint: "bg-violet-600 text-white dark:bg-violet-500",
  credit: "bg-amber-600 text-white dark:bg-amber-500",
  other: "bg-slate-600 text-white dark:bg-slate-500",
};

function SortableAccountCard({
  account,
  onEdit,
  onDelete,
  formatCurrency: fmt,
}: {
  account: Account;
  onEdit: (account: Account) => void;
  onDelete: (id: string) => void;
  formatCurrency: (amount: number, currency?: string) => string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: account.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  const iconBg = ACCOUNT_ICON_BG[account.type] || ACCOUNT_ICON_BG.other;
  const typeBadge = ACCOUNT_TYPE_COLORS[account.type] || ACCOUNT_TYPE_COLORS.other;
  const netChange = account.transactionTotal;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative rounded-xl border bg-card text-card-foreground shadow-sm transition-shadow hover:shadow-md ${
        isDragging ? "opacity-50 shadow-lg" : ""
      }`}
    >
      {/* Drag handle strip */}
      <button
        className="absolute left-0 top-0 bottom-0 w-6 flex items-center justify-center rounded-l-xl opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing touch-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-r-none"
        aria-label={`Reorder ${account.name}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4 text-muted-foreground/50" />
      </button>

      <div className="p-5 pl-6">
        {/* Top row: icon + name + actions */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconBg}`}>
              {account.type === "credit" ? (
                <Wallet className="h-5 w-5" />
              ) : (
                <Landmark className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-sm leading-tight truncate">{account.name}</h3>
              <p className="text-xs text-muted-foreground truncate">
                {account.bankName || "No bank"}
              </p>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label={`Actions for ${account.name}`}
              >
                <MoreVertical className="h-4 w-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(account)}>
                <Pencil className="h-4 w-4" />
                Edit account
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onDelete(account.id)}
              >
                <Trash2 className="h-4 w-4" />
                Delete account
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Balance — hero element */}
        <div className="mt-4">
          <p
            className={`text-2xl font-bold tabular-nums tracking-tight ${
              account.currentBalance >= 0
                ? "text-foreground"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {fmt(account.currentBalance, account.currency)}
          </p>
        </div>

        {/* Footer: type badge + net change */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${typeBadge}`}>
            {account.type === "credit" ? "Credit card" : account.type}
          </span>
          {netChange !== 0 && (
            <span
              className={`text-xs font-medium tabular-nums ${
                netChange >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-500 dark:text-red-400"
              }`}
            >
              {netChange >= 0 ? "+" : ""}
              {fmt(netChange, account.currency)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [type, setType] = useState("checking");
  const [bankName, setBankName] = useState("");
  const [iban, setIban] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [initialBalance, setInitialBalance] = useState("");

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts");
      const data = await res.json();
      setAccounts(data);
    } catch (err) {
      console.error("Failed to fetch accounts:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const resetForm = () => {
    setName("");
    setType("checking");
    setBankName("");
    setIban("");
    setCurrency("EUR");
    setInitialBalance("");
    setEditingAccount(null);
  };

  const openEditDialog = (account: Account) => {
    setEditingAccount(account);
    setName(account.name);
    setType(account.type);
    setBankName(account.bankName || "");
    setIban(account.iban || "");
    setCurrency(account.currency);
    setInitialBalance(String(account.initialBalance));
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    const payload = {
      ...(editingAccount ? { id: editingAccount.id } : {}),
      name,
      type,
      bankName: bankName || null,
      iban: iban || null,
      currency,
      initialBalance: parseFloat(initialBalance) || 0,
    };

    const method = editingAccount ? "PUT" : "POST";
    await fetch("/api/accounts", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setDialogOpen(false);
    resetForm();
    fetchAccounts();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/accounts?id=${id}`, { method: "DELETE" });
    fetchAccounts();
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = accounts.findIndex((a) => a.id === active.id);
    const newIndex = accounts.findIndex((a) => a.id === over.id);
    const newAccounts = arrayMove(accounts, oldIndex, newIndex);
    setAccounts(newAccounts);

    await fetch("/api/accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: newAccounts.map((a) => a.id) }),
    });
  };

  const totalBalance = accounts.reduce((sum, a) => sum + a.currentBalance, 0);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Accounts</h1>
          <p className="text-muted-foreground">
            Manage your bank accounts and view balances.
          </p>
        </div>
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Account
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {editingAccount ? "Edit Account" : "Add New Account"}
              </DialogTitle>
              <DialogDescription>
                {editingAccount
                  ? "Update the details for this account."
                  : "Add a new bank account to track."}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Account Name</Label>
                <Input
                  id="name"
                  placeholder="e.g. Main Checking"
                  autoComplete="off"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="type">Account Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="bankName">Bank Name (optional)</Label>
                <Input
                  id="bankName"
                  placeholder="e.g. ING, ABN AMRO, Rabobank"
                  autoComplete="off"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="iban">IBAN (optional)</Label>
                <Input
                  id="iban"
                  placeholder="e.g. NL91ABNA0417164300"
                  value={iban}
                  onChange={(e) => setIban(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="currency">Currency</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="balance">Starting Balance</Label>
                  <Input
                    id="balance"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={initialBalance}
                    onChange={(e) => setInitialBalance(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setDialogOpen(false);
                  resetForm();
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={!name}>
                {editingAccount ? "Save Changes" : "Create Account"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Total Balance Card */}
      {accounts.length > 0 && (
        <div className="rounded-xl bg-primary p-6 text-primary-foreground">
          <p className="text-sm font-medium opacity-80">Total Balance</p>
          <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight">
            {formatCurrency(totalBalance)}
          </p>
          <p className="mt-2 text-sm opacity-60">
            {accounts.length} account{accounts.length !== 1 ? "s" : ""} connected
          </p>
        </div>
      )}

      {/* Account Cards */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse rounded-xl border p-5">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-muted" />
                <div className="space-y-1.5">
                  <div className="h-3.5 w-24 rounded bg-muted" />
                  <div className="h-3 w-16 rounded bg-muted" />
                </div>
              </div>
              <div className="mt-4 h-7 w-28 rounded bg-muted" />
              <div className="mt-3 h-5 w-16 rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16">
          <Landmark className="h-12 w-12 text-muted-foreground/30 mb-3" />
          <h3 className="text-base font-medium text-muted-foreground mb-1">
            No accounts yet
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Add your first bank account to start tracking.
          </p>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Account
          </Button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={accounts.map((a) => a.id)}
            strategy={rectSortingStrategy}
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-live="polite">
              {accounts.map((account) => (
                <SortableAccountCard
                  key={account.id}
                  account={account}
                  onEdit={openEditDialog}
                  onDelete={handleDelete}
                  formatCurrency={formatCurrency}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
