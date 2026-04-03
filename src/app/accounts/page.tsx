"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import {
  Landmark,
  Plus,
  Pencil,
  Trash2,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

interface Account {
  id: string;
  name: string;
  type: string;
  bankName: string | null;
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

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [type, setType] = useState("checking");
  const [bankName, setBankName] = useState("");
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
    setCurrency("EUR");
    setInitialBalance("");
    setEditingAccount(null);
  };

  const openEditDialog = (account: Account) => {
    setEditingAccount(account);
    setName(account.name);
    setType(account.type);
    setBankName(account.bankName || "");
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
    setDeleteConfirm(null);
    fetchAccounts();
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
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
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
        <Card className="bg-primary text-primary-foreground">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium opacity-90">
              Total Balance Across All Accounts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {formatCurrency(totalBalance)}
            </div>
            <p className="mt-1 text-sm opacity-75">
              {accounts.length} account{accounts.length !== 1 ? "s" : ""}{" "}
              connected
            </p>
          </CardContent>
        </Card>
      )}

      {/* Account Cards */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-2">
                <div className="h-4 w-32 rounded bg-muted" />
              </CardHeader>
              <CardContent>
                <div className="h-8 w-24 rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Landmark className="h-16 w-16 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium text-muted-foreground mb-1">
              No accounts yet
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Add your first bank account to start tracking your finances.
            </p>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Your First Account
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => (
            <Card key={account.id} className="relative group">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <Landmark className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{account.name}</CardTitle>
                      <CardDescription>
                        {account.bankName || "No bank specified"}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant="secondary" className="capitalize">
                    {account.type}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold ${
                    account.currentBalance >= 0
                      ? "text-foreground"
                      : "text-red-600"
                  }`}
                >
                  {formatCurrency(account.currentBalance, account.currency)}
                </div>
                <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <TrendingUp className="h-3 w-3 text-emerald-500" />
                    Initial: {formatCurrency(account.initialBalance, account.currency)}
                  </span>
                  {account.transactionTotal !== 0 && (
                    <span className="flex items-center gap-1">
                      {account.transactionTotal >= 0 ? (
                        <TrendingUp className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <TrendingDown className="h-3 w-3 text-red-500" />
                      )}
                      Net: {formatCurrency(account.transactionTotal, account.currency)}
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div className="mt-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEditDialog(account)}
                  >
                    <Pencil className="mr-1 h-3 w-3" />
                    Edit
                  </Button>
                  {deleteConfirm === account.id ? (
                    <div className="flex gap-1">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(account.id)}
                      >
                        Confirm
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDeleteConfirm(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeleteConfirm(account.id)}
                    >
                      <Trash2 className="mr-1 h-3 w-3" />
                      Delete
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
