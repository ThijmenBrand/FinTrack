"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CsvUploadDialog } from "@/components/csv-upload-dialog";
import { CategorizePopover } from "@/components/categorize-popover";
import {
  Upload,
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Trash2,
  FileSpreadsheet,
  ArrowLeftRight,
  Loader2,
} from "lucide-react";

interface Category {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
}

interface Transaction {
  id: string;
  accountId: string;
  accountName: string | null;
  date: string;
  description: string;
  amount: number;
  balance: number | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  type: "income" | "expense" | "internal_transfer";
  linkedTransactionId: string | null;
  notes: string | null;
  isManual: boolean;
  importBatchId: string | null;
  createdAt: string;
}

interface Account {
  id: string;
  name: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

function formatDate(dateStr: string) {
  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(dateStr));
}

const TYPE_BADGES: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  income: { label: "Income", variant: "default" },
  expense: { label: "Expense", variant: "destructive" },
  internal_transfer: { label: "Transfer", variant: "secondary" },
};

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 0,
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [detectingTransfers, setDetectingTransfers] = useState(false);
  const [transferResult, setTransferResult] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortBy, setSortBy] = useState("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts");
      const data = await res.json();
      setAccounts(data);
    } catch (err) {
      console.error("Failed to fetch accounts:", err);
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch("/api/categories");
      const data = await res.json();
      setCategories(data);
    } catch (err) {
      console.error("Failed to fetch categories:", err);
    }
  }, []);

  const handleDetectTransfers = async () => {
    setDetectingTransfers(true);
    setTransferResult(null);
    try {
      const res = await fetch("/api/transactions/detect-transfers", {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        setTransferResult(
          data.matchedPairs > 0
            ? `Found ${data.matchedPairs} transfer pair${data.matchedPairs !== 1 ? "s" : ""} (${data.totalTransactionsUpdated} transactions updated)`
            : "No new internal transfers detected"
        );
        if (data.matchedPairs > 0) fetchTransactions();
      }
    } catch (err) {
      console.error("Failed to detect transfers:", err);
    } finally {
      setDetectingTransfers(false);
    }
  };

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(pagination.page),
        limit: String(pagination.limit),
        sortBy,
        sortOrder,
      });
      if (search) params.set("search", search);
      if (accountFilter !== "all") params.set("accountId", accountFilter);
      if (typeFilter !== "all") params.set("type", typeFilter);

      const res = await fetch(`/api/transactions?${params}`);
      const data = await res.json();
      setTransactions(data.data);
      setPagination(data.pagination);
    } catch (err) {
      console.error("Failed to fetch transactions:", err);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, sortBy, sortOrder, search, accountFilter, typeFilter]);

  useEffect(() => {
    fetchAccounts();
    fetchCategories();
  }, [fetchAccounts, fetchCategories]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortOrder("desc");
    }
    setPagination((p) => ({ ...p, page: 1 }));
  };

  const handleSearch = (value: string) => {
    setSearch(value);
    setPagination((p) => ({ ...p, page: 1 }));
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/transactions?id=${id}`, { method: "DELETE" });
    setDeleteConfirm(null);
    fetchTransactions();
  };

  const SortIcon = ({ column }: { column: string }) => {
    if (sortBy !== column)
      return <ArrowUpDown className="ml-1 h-3 w-3 text-muted-foreground/50" />;
    return sortOrder === "asc" ? (
      <ArrowUp className="ml-1 h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3" />
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Transactions</h1>
          <p className="text-muted-foreground">
            View, filter, and manage your transactions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleDetectTransfers}
            disabled={detectingTransfers}
          >
            {detectingTransfers ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ArrowLeftRight className="mr-2 h-4 w-4" />
            )}
            Detect Transfers
          </Button>
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Import CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search descriptions..."
                className="pl-9"
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
              />
            </div>
            <Select
              value={accountFilter}
              onValueChange={(v) => {
                setAccountFilter(v);
                setPagination((p) => ({ ...p, page: 1 }));
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Accounts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Accounts</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={typeFilter}
              onValueChange={(v) => {
                setTypeFilter(v);
                setPagination((p) => ({ ...p, page: 1 }));
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="income">Income</SelectItem>
                <SelectItem value="expense">Expense</SelectItem>
                <SelectItem value="internal_transfer">Transfer</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Transfer Detection Result Banner */}
      {transferResult && (
        <div className="flex items-center justify-between rounded-lg border bg-muted/50 px-4 py-3">
          <p className="text-sm flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
            {transferResult}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTransferResult(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Data Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              {pagination.total} transaction{pagination.total !== 1 ? "s" : ""}
            </CardTitle>
            <Select
              value={String(pagination.limit)}
              onValueChange={(v) =>
                setPagination((p) => ({ ...p, limit: Number(v), page: 1 }))
              }
            >
              <SelectTrigger className="w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10 rows</SelectItem>
                <SelectItem value="25">25 rows</SelectItem>
                <SelectItem value="50">50 rows</SelectItem>
                <SelectItem value="100">100 rows</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading && transactions.length === 0 ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-12 rounded bg-muted animate-pulse" />
              ))}
            </div>
          ) : transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <FileSpreadsheet className="h-16 w-16 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-medium text-muted-foreground mb-1">
                No transactions yet
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Import a CSV bank statement to get started.
              </p>
              <Button onClick={() => setUploadOpen(true)}>
                <Upload className="mr-2 h-4 w-4" />
                Import CSV
              </Button>
            </div>
          ) : (
            <>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead
                        className="cursor-pointer select-none whitespace-nowrap"
                        onClick={() => handleSort("date")}
                      >
                        <span className="flex items-center">
                          Date
                          <SortIcon column="date" />
                        </span>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none"
                        onClick={() => handleSort("description")}
                      >
                        <span className="flex items-center">
                          Description
                          <SortIcon column="description" />
                        </span>
                      </TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead
                        className="cursor-pointer select-none text-right whitespace-nowrap"
                        onClick={() => handleSort("amount")}
                      >
                        <span className="flex items-center justify-end">
                          Amount
                          <SortIcon column="amount" />
                        </span>
                      </TableHead>
                      <TableHead className="w-[50px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((tx) => {
                      const typeInfo = TYPE_BADGES[tx.type] || TYPE_BADGES.expense;
                      return (
                        <TableRow key={tx.id}>
                          <TableCell className="whitespace-nowrap text-sm">
                            {formatDate(tx.date)}
                          </TableCell>
                          <TableCell className="max-w-[300px] truncate text-sm font-medium">
                            {tx.description}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {tx.accountName || "—"}
                          </TableCell>
                          <TableCell>
                            <CategorizePopover
                              transactionId={tx.id}
                              transactionDescription={tx.description}
                              currentCategoryId={tx.categoryId}
                              currentCategoryName={tx.categoryName}
                              currentCategoryColor={tx.categoryColor}
                              categories={categories}
                              onCategorized={() => {
                                fetchTransactions();
                                fetchCategories();
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <Badge variant={typeInfo.variant} className="text-xs">
                              {typeInfo.label}
                            </Badge>
                          </TableCell>
                          <TableCell
                            className={`text-right font-mono text-sm font-medium whitespace-nowrap ${
                              tx.amount >= 0 ? "text-emerald-600" : "text-red-600"
                            }`}
                          >
                            {tx.amount >= 0 ? "+" : ""}
                            {formatCurrency(tx.amount)}
                          </TableCell>
                          <TableCell>
                            {deleteConfirm === tx.id ? (
                              <div className="flex gap-1">
                                <Button
                                  variant="destructive"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => handleDelete(tx.id)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => setDeleteConfirm(null)}
                                >
                                  ✕
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 opacity-0 group-hover:opacity-100"
                                onClick={() => setDeleteConfirm(tx.id)}
                              >
                                <Trash2 className="h-3 w-3 text-muted-foreground" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between pt-4">
                <p className="text-sm text-muted-foreground">
                  Showing {(pagination.page - 1) * pagination.limit + 1}–
                  {Math.min(
                    pagination.page * pagination.limit,
                    pagination.total
                  )}{" "}
                  of {pagination.total}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pagination.page <= 1}
                    onClick={() =>
                      setPagination((p) => ({ ...p, page: p.page - 1 }))
                    }
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground px-2">
                    Page {pagination.page} of {pagination.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() =>
                      setPagination((p) => ({ ...p, page: p.page + 1 }))
                    }
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* CSV Upload Dialog */}
      <CsvUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        accounts={accounts}
        onUploadComplete={fetchTransactions}
      />
    </div>
  );
}
