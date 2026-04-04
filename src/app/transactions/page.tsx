"use client";

import { useEffect, useState, useCallback, useRef, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AddToPotDialog } from "@/components/add-to-pot-dialog";
import { CsvUploadDialog } from "@/components/csv-upload-dialog";
import { TransactionDetailDialog } from "@/components/transaction-detail-dialog";
import { CategorizePopover } from "@/components/categorize-popover";
import { ReimbursementPicker } from "@/components/reimbursement-picker";
import { CreatePotDialog } from "@/components/create-pot-dialog";
import { PotTransactionPicker } from "@/components/pot-transaction-picker";
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
  X,
  ChevronDown,
  Check,
  TrendingUp,
  TrendingDown,
  Equal,
  Receipt,
  Undo2,
  Plus,
  Package,
  Minus,
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
  type: "income" | "expense" | "internal_transfer" | "reimbursement";
  linkedTransactionId: string | null;
  linkedAccountName: string | null;
  reimbursesTransactionId: string | null;
  reimbursesDescription: string | null;
  effectiveAmount: number;
  reimbursementCount: number;
  reimbursedTotal: number;
  groupId: string | null;
  groupName: string | null;
  notes: string | null;
  isManual: boolean;
  importBatchId: string | null;
  createdAt: string;
}

interface Pot {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  netAmount: number;
  transactionCount: number;
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

interface FilterToken {
  key: string;
  value: string;
  label: string;
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
  reimbursement: { label: "Reimbursement", variant: "outline" },
};

const TYPE_OPTIONS = [
  { value: "income", label: "Income" },
  { value: "expense", label: "Expense" },
  { value: "internal_transfer", label: "Transfer" },
  { value: "reimbursement", label: "Reimbursement" },
];

const PERIOD_OPTIONS = [
  { value: "this-month", label: "This Month" },
  { value: "last-month", label: "Last Month" },
  { value: "last-3-months", label: "Last 3 Months" },
  { value: "last-6-months", label: "Last 6 Months" },
  { value: "this-year", label: "This Year" },
  { value: "last-year", label: "Last Year" },
];

const FILTER_KEYS = ["account", "category", "type", "period"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

function computeDateRange(period: string): { from: string; to: string } {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");

  switch (period) {
    case "this-month":
      return { from: `${yyyy}-${mm}-01`, to: "" };
    case "last-month": {
      const prev = new Date(yyyy, now.getMonth() - 1, 1);
      const lastDay = new Date(yyyy, now.getMonth(), 0);
      return {
        from: `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-01`,
        to: `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`,
      };
    }
    case "last-3-months": {
      const d = new Date(yyyy, now.getMonth() - 2, 1);
      return { from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`, to: "" };
    }
    case "last-6-months": {
      const d = new Date(yyyy, now.getMonth() - 5, 1);
      return { from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`, to: "" };
    }
    case "this-year":
      return { from: `${yyyy}-01-01`, to: "" };
    case "last-year":
      return { from: `${yyyy - 1}-01-01`, to: `${yyyy - 1}-12-31` };
    default:
      return { from: "", to: "" };
  }
}

// --- Column Header Filter Dropdown ---
function HeaderFilterDropdown({
  label,
  options,
  value,
  onChange,
  sortable,
  sortBy,
  currentSortBy,
  sortOrder,
  onSort,
}: {
  label: string;
  options: { value: string; label: string; color?: string | null }[];
  value: string;
  onChange: (value: string) => void;
  sortable?: boolean;
  sortBy?: string;
  currentSortBy?: string;
  sortOrder?: "asc" | "desc";
  onSort?: (col: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filterText, setFilterText] = useState("");
  const isFiltered = value !== "all";

  const filtered = filterText
    ? options.filter((o) => o.label.toLowerCase().includes(filterText.toLowerCase()))
    : options;

  return (
    <div className="flex items-center gap-0.5">
      {sortable && sortBy && onSort && (
        <button
          className="flex items-center hover:text-foreground transition-colors"
          onClick={() => onSort(sortBy)}
        >
          {label}
          {currentSortBy === sortBy ? (
            sortOrder === "asc" ? (
              <ArrowUp className="ml-1 h-3 w-3" />
            ) : (
              <ArrowDown className="ml-1 h-3 w-3" />
            )
          ) : (
            <ArrowUpDown className="ml-1 h-3 w-3 text-muted-foreground/50" />
          )}
        </button>
      )}
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setFilterText(""); }}>
        <PopoverTrigger asChild>
          <button
            className={`flex items-center gap-0.5 hover:text-foreground transition-colors ${
              isFiltered ? "text-foreground font-semibold" : ""
            }`}
          >
            {!sortable && label}
            <ChevronDown className={`h-3 w-3 ${isFiltered ? "text-foreground" : "text-muted-foreground/60"}`} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-0">
          <div className="p-2 border-b">
            <Input
              placeholder={`Filter ${label.toLowerCase()}...`}
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="h-7 text-xs"
              autoFocus
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            <button
              className={`w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors ${
                value === "all" ? "font-medium" : ""
              }`}
              onClick={() => { onChange("all"); setOpen(false); setFilterText(""); }}
            >
              <span className="w-4 h-4 flex items-center justify-center">
                {value === "all" && <Check className="h-3 w-3" />}
              </span>
              All {label}s
            </button>
            {filtered.map((opt) => (
              <button
                key={opt.value}
                className={`w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors ${
                  value === opt.value ? "font-medium" : ""
                }`}
                onClick={() => { onChange(opt.value); setOpen(false); setFilterText(""); }}
              >
                <span className="w-4 h-4 flex items-center justify-center">
                  {value === opt.value && <Check className="h-3 w-3" />}
                </span>
                {opt.color && (
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: opt.color }}
                  />
                )}
                <span className="truncate">{opt.label}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-3 text-center">No matches</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// --- Main Page ---
export default function TransactionsPageWrapper() {
  return (
    <Suspense>
      <TransactionsPage />
    </Suspense>
  );
}

function TransactionsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 0,
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [distinctTypes, setDistinctTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [detectingTransfers, setDetectingTransfers] = useState(false);
  const [transferResult, setTransferResult] = useState<string | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [reimbursePicker, setReimbursePicker] = useState<Transaction | null>(null);
  const [totals, setTotals] = useState<{ income: number; expense: number; transfers: number; reimbursements: number; net: number } | null>(null);

  // Pots state
  const [pots, setPots] = useState<Pot[]>([]);
  const [createPotOpen, setCreatePotOpen] = useState(false);
  const [addToPotPicker, setAddToPotPicker] = useState<Pot | null>(null);
  const [deletePotConfirm, setDeletePotConfirm] = useState<string | null>(null);
  const [addToPotTx, setAddToPotTx] = useState<Transaction | null>(null);

  // Filters — initialized from URL params
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [accountFilter, setAccountFilter] = useState(searchParams.get("account") || "all");
  const [categoryFilter, setCategoryFilter] = useState(searchParams.get("category") || "all");
  const [typeFilter, setTypeFilter] = useState(searchParams.get("type") || "all");
  const [periodFilter, setPeriodFilter] = useState(searchParams.get("period") || "all");
  const [sortBy, setSortBy] = useState(searchParams.get("sortBy") || "date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">((searchParams.get("sortOrder") as "asc" | "desc") || "desc");

  // Search bar state
  const [inputValue, setInputValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Sync filters to URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (accountFilter !== "all") params.set("account", accountFilter);
    if (categoryFilter !== "all") params.set("category", categoryFilter);
    if (typeFilter !== "all") params.set("type", typeFilter);
    if (periodFilter !== "all") params.set("period", periodFilter);
    if (sortBy !== "date") params.set("sortBy", sortBy);
    if (sortOrder !== "desc") params.set("sortOrder", sortOrder);
    const qs = params.toString();
    const newUrl = qs ? `/transactions?${qs}` : "/transactions";
    router.replace(newUrl, { scroll: false });
  }, [search, accountFilter, categoryFilter, typeFilter, periodFilter, sortBy, sortOrder, router]);

  // Compute active filter tokens for display
  const activeTokens = useMemo(() => {
    const tokens: FilterToken[] = [];
    if (accountFilter !== "all") {
      const acc = accounts.find((a) => a.id === accountFilter);
      tokens.push({ key: "account", value: accountFilter, label: `account:${acc?.name || accountFilter}` });
    }
    if (categoryFilter !== "all") {
      const cat = categories.find((c) => c.id === categoryFilter);
      tokens.push({ key: "category", value: categoryFilter, label: `category:${cat?.name || categoryFilter}` });
    }
    if (typeFilter !== "all") {
      const t = TYPE_OPTIONS.find((o) => o.value === typeFilter);
      tokens.push({ key: "type", value: typeFilter, label: `type:${t?.label || typeFilter}` });
    }
    if (periodFilter !== "all") {
      const p = PERIOD_OPTIONS.find((o) => o.value === periodFilter);
      tokens.push({ key: "period", value: periodFilter, label: `period:${p?.label || periodFilter}` });
    }
    if (search) {
      tokens.push({ key: "search", value: search, label: search });
    }
    return tokens;
  }, [accountFilter, categoryFilter, typeFilter, periodFilter, search, accounts, categories]);

  // Compute suggestions based on input
  const suggestions = useMemo(() => {
    const val = inputValue.trim().toLowerCase();
    if (!val) {
      // Show available filter keys
      return FILTER_KEYS.map((k) => ({
        type: "key" as const,
        key: k,
        label: `${k}:`,
        description: k === "account" ? "Filter by account" : k === "category" ? "Filter by category" : k === "type" ? "Filter by type" : "Filter by time period",
      }));
    }

    // Check if typing a filter like "account:" or "account:par"
    const colonIdx = val.indexOf(":");
    if (colonIdx !== -1) {
      const key = val.slice(0, colonIdx) as FilterKey;
      const query = val.slice(colonIdx + 1);
      if (FILTER_KEYS.includes(key)) {
        let options: { value: string; label: string }[] = [];
        if (key === "account") {
          options = accounts.map((a) => ({ value: a.id, label: a.name }));
        } else if (key === "category") {
          options = categories.map((c) => ({ value: c.id, label: c.name }));
        } else if (key === "type") {
          options = TYPE_OPTIONS.filter((o) => distinctTypes.includes(o.value));
        } else if (key === "period") {
          options = PERIOD_OPTIONS;
        }
        return options
          .filter((o) => !query || o.label.toLowerCase().includes(query))
          .map((o) => ({
            type: "value" as const,
            key,
            value: o.value,
            label: `${key}:${o.label}`,
            description: "",
          }));
      }
    }

    // Suggest filter keys that match, plus treat as free text search
    const keyMatches = FILTER_KEYS
      .filter((k) => k.startsWith(val))
      .map((k) => ({
        type: "key" as const,
        key: k,
        label: `${k}:`,
        description: `Filter by ${k}`,
      }));

    return [
      ...keyMatches,
      { type: "search" as const, key: "search", label: val, description: "Search descriptions", value: val },
    ];
  }, [inputValue, accounts, categories, distinctTypes]);

  const applyFilter = (key: string, value: string) => {
    if (key === "account") setAccountFilter(value);
    else if (key === "category") setCategoryFilter(value);
    else if (key === "type") setTypeFilter(value);
    else if (key === "period") setPeriodFilter(value);
    else if (key === "search") setSearch(value);
    setPagination((p) => ({ ...p, page: 1 }));
  };

  const removeFilter = (key: string) => {
    if (key === "account") setAccountFilter("all");
    else if (key === "category") setCategoryFilter("all");
    else if (key === "type") setTypeFilter("all");
    else if (key === "period") setPeriodFilter("all");
    else if (key === "search") setSearch("");
    setPagination((p) => ({ ...p, page: 1 }));
  };

  const clearAllFilters = () => {
    setAccountFilter("all");
    setCategoryFilter("all");
    setTypeFilter("all");
    setPeriodFilter("all");
    setSearch("");
    setPagination((p) => ({ ...p, page: 1 }));
  };

  const handleSuggestionSelect = (suggestion: (typeof suggestions)[number]) => {
    if (suggestion.type === "key") {
      setInputValue(`${suggestion.key}:`);
      inputRef.current?.focus();
      return;
    }
    if (suggestion.type === "value" && "value" in suggestion) {
      applyFilter(suggestion.key, suggestion.value!);
    } else if (suggestion.type === "search") {
      applyFilter("search", inputValue.trim());
    }
    setInputValue("");
    setShowSuggestions(false);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && inputValue === "" && activeTokens.length > 0) {
      const lastToken = activeTokens[activeTokens.length - 1];
      removeFilter(lastToken.key);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (showSuggestions && suggestions.length > 0) {
        handleSuggestionSelect(suggestions[selectedSuggestion]);
      } else if (inputValue.trim()) {
        applyFilter("search", inputValue.trim());
        setInputValue("");
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedSuggestion((s) => Math.min(s + 1, suggestions.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedSuggestion((s) => Math.max(s - 1, 0));
    }
    if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Compute dateFrom/dateTo from periodFilter
  const { from: dateFrom, to: dateTo } = useMemo(
    () => computeDateRange(periodFilter),
    [periodFilter]
  );

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

  const fetchPots = useCallback(async () => {
    try {
      const res = await fetch("/api/pots");
      const data = await res.json();
      setPots(data);
    } catch (err) {
      console.error("Failed to fetch pots:", err);
    }
  }, []);

  const handleRemoveFromPot = async (potId: string, transactionId: string) => {
    try {
      await fetch(`/api/pots/transactions?potId=${potId}&transactionId=${transactionId}`, {
        method: "DELETE",
      });
      fetchPots();
      fetchTransactions();
    } catch (err) {
      console.error("Failed to remove from pot:", err);
    }
  };

  const handleDeletePot = async (potId: string) => {
    try {
      await fetch(`/api/pots?id=${potId}`, { method: "DELETE" });
      setDeletePotConfirm(null);
      fetchPots();
      fetchTransactions();
    } catch (err) {
      console.error("Failed to delete pot:", err);
    }
  };

  const handleAddToPot = async (potId: string, transactionId: string) => {
    try {
      await fetch("/api/pots/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ potId, transactionId }),
      });
      fetchPots();
      fetchTransactions();
    } catch (err) {
      console.error("Failed to add to pot:", err);
    }
  };

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
      if (categoryFilter !== "all") params.set("categoryId", categoryFilter);
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);

      const res = await fetch(`/api/transactions?${params}`);
      const data = await res.json();
      setTransactions(data.data);
      setPagination(data.pagination);
      if (data.distinctTypes) setDistinctTypes(data.distinctTypes);
      if (data.totals) setTotals(data.totals);
    } catch (err) {
      console.error("Failed to fetch transactions:", err);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, sortBy, sortOrder, search, accountFilter, categoryFilter, typeFilter, dateFrom, dateTo]);

  useEffect(() => {
    fetchAccounts();
    fetchCategories();
    fetchPots();
  }, [fetchAccounts, fetchCategories, fetchPots]);

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

  const handleDelete = async (id: string) => {
    await fetch(`/api/transactions?id=${id}`, { method: "DELETE" });
    setDeleteConfirm(null);
    fetchTransactions();
  };

  const handleUnlinkReimbursement = async (id: string) => {
    await fetch(`/api/transactions/reimburse?id=${id}`, { method: "DELETE" });
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

  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name }));
  const categoryOptions = categories.map((c) => ({ value: c.id, label: c.name, color: c.color }));
  const availableTypeOptions = TYPE_OPTIONS.filter((o) => distinctTypes.includes(o.value));

  // Build display items: interleave pot summary rows before first transaction of each pot
  const potsById = useMemo(() => {
    const map = new Map<string, Pot>();
    for (const pot of pots) map.set(pot.id, pot);
    return map;
  }, [pots]);

  type DisplayItem =
    | { kind: "transaction"; data: Transaction }
    | { kind: "pot"; data: Pot };

  const displayItems: DisplayItem[] = useMemo(() => {
    const items: DisplayItem[] = [];
    const seenGroups = new Set<string>();
    for (const tx of transactions) {
      if (tx.groupId && !seenGroups.has(tx.groupId)) {
        seenGroups.add(tx.groupId);
        const pot = potsById.get(tx.groupId);
        if (pot) {
          items.push({ kind: "pot", data: pot });
        }
      }
      items.push({ kind: "transaction", data: tx });
    }
    return items;
  }, [transactions, potsById]);

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
          <Button variant="outline" size="sm" onClick={() => setCreatePotOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Pot
          </Button>
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

      {/* GitHub-style Filter Bar */}
      <div className="relative">
        <div
          className="flex items-center gap-1.5 flex-wrap rounded-md border bg-background px-3 py-1.5 ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 min-h-[40px] cursor-text"
          onClick={() => inputRef.current?.focus()}
        >
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          {activeTokens.map((token) => (
            <Badge
              key={token.key}
              variant="secondary"
              className="gap-1 pl-2 pr-1 py-0.5 text-xs font-mono shrink-0"
            >
              <span className="text-muted-foreground">{token.key === "search" ? "" : `${token.key}:`}</span>
              <span>{token.key === "search" ? token.label : token.label.split(":")[1]}</span>
              <button
                className="ml-0.5 rounded-sm hover:bg-muted-foreground/20 p-0.5"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFilter(token.key);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <input
            ref={inputRef}
            type="text"
            className="flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder={activeTokens.length === 0 ? "Filter transactions... (e.g. account:ING type:expense)" : "Add filter..."}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setShowSuggestions(true);
              setSelectedSuggestion(0);
            }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={handleInputKeyDown}
          />
          {activeTokens.length > 0 && (
            <button
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                clearAllFilters();
              }}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Suggestions Dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div
            ref={suggestionsRef}
            className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md overflow-hidden"
          >
            <div className="max-h-64 overflow-y-auto p-1">
              {suggestions.map((s, i) => (
                <button
                  key={`${s.key}-${s.label}`}
                  className={`w-full flex items-center justify-between rounded-sm px-3 py-2 text-sm transition-colors ${
                    i === selectedSuggestion ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                  }`}
                  onMouseEnter={() => setSelectedSuggestion(i)}
                  onClick={() => handleSuggestionSelect(s)}
                >
                  <span className="font-mono">
                    {s.type === "search" ? (
                      <span className="flex items-center gap-2">
                        <Search className="h-3 w-3 text-muted-foreground" />
                        {s.label}
                      </span>
                    ) : (
                      s.label
                    )}
                  </span>
                  {s.description && (
                    <span className="text-xs text-muted-foreground">{s.description}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Active filter summary with date range */}
      {periodFilter !== "all" && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            Showing: {dateFrom && formatDate(dateFrom)}
            {dateTo ? ` — ${formatDate(dateTo)}` : " — now"}
          </span>
        </div>
      )}

      {/* Cumulative Totals Summary */}
      {activeTokens.length > 0 && totals && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              Income
            </div>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              +{formatCurrency(totals.income)}
            </p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <TrendingDown className="h-4 w-4 text-red-500" />
              Expenses
            </div>
            <p className="text-2xl font-bold text-red-600 dark:text-red-400">
              {formatCurrency(totals.expense)}
            </p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Equal className="h-4 w-4" />
              Net Total
            </div>
            <p className={`text-2xl font-bold ${
              totals.net >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}>
              {totals.net >= 0 ? "+" : ""}{formatCurrency(totals.net)}
            </p>
          </div>
        </div>
      )}

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
                No transactions found
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {activeTokens.length > 0
                  ? "Try adjusting your filters."
                  : "Import a CSV bank statement to get started."}
              </p>
              {activeTokens.length > 0 ? (
                <Button variant="outline" onClick={clearAllFilters}>
                  Clear Filters
                </Button>
              ) : (
                <Button onClick={() => setUploadOpen(true)}>
                  <Upload className="mr-2 h-4 w-4" />
                  Import CSV
                </Button>
              )}
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
                      <TableHead className="select-none">
                        <HeaderFilterDropdown
                          label="Account"
                          options={accountOptions}
                          value={accountFilter}
                          onChange={(v) => { setAccountFilter(v); setPagination((p) => ({ ...p, page: 1 })); }}
                        />
                      </TableHead>
                      <TableHead className="select-none">
                        <HeaderFilterDropdown
                          label="Category"
                          options={categoryOptions}
                          value={categoryFilter}
                          onChange={(v) => { setCategoryFilter(v); setPagination((p) => ({ ...p, page: 1 })); }}
                        />
                      </TableHead>
                      <TableHead className="select-none">
                        <HeaderFilterDropdown
                          label="Type"
                          options={availableTypeOptions}
                          value={typeFilter}
                          onChange={(v) => { setTypeFilter(v); setPagination((p) => ({ ...p, page: 1 })); }}
                        />
                      </TableHead>
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
                    {displayItems.map((item) => {
                      if (item.kind === "pot") {
                        const pot = item.data;
                        return (
                          <TableRow key={`pot-${pot.id}`} className="bg-muted/40 hover:bg-muted/60 border-t-2">
                            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                              —
                            </TableCell>
                            <TableCell className="text-sm font-semibold" colSpan={2}>
                              <div className="flex items-center gap-2">
                                <Package className="h-4 w-4 text-muted-foreground" />
                                <span>{pot.name}</span>
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                  {pot.transactionCount} tx
                                </Badge>
                              </div>
                            </TableCell>
                            <TableCell>
                              {pot.categoryName && (
                                <div className="flex items-center gap-1.5">
                                  {pot.categoryColor && (
                                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: pot.categoryColor }} />
                                  )}
                                  <span className="text-xs text-muted-foreground">{pot.categoryName}</span>
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">Pot</Badge>
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap">
                              <span className={`font-mono text-sm font-semibold ${
                                pot.netAmount >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                              }`}>
                                {pot.netAmount >= 0 ? "+" : ""}{formatCurrency(pot.netAmount)}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                  title="Add transactions to pot"
                                  onClick={() => setAddToPotPicker(pot)}
                                >
                                  <Plus className="h-3 w-3" />
                                </Button>
                                {deletePotConfirm === pot.id ? (
                                  <>
                                    <Button size="icon" variant="destructive" className="h-7 w-7" onClick={() => handleDeletePot(pot.id)}>
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setDeletePotConfirm(null)}>
                                      <X className="h-3 w-3" />
                                    </Button>
                                  </>
                                ) : (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                    onClick={() => setDeletePotConfirm(pot.id)}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      }

                      const tx = item.data;
                      const isTransfer = tx.type === "internal_transfer" || tx.categoryName === "Internal Transfer";
                      const isReimbursement = tx.type === "reimbursement";
                      const isInPot = !!tx.groupId;
                      const hasReimbursements = tx.reimbursementCount > 0;
                      const typeInfo = isTransfer
                        ? TYPE_BADGES.internal_transfer
                        : (TYPE_BADGES[tx.type] || TYPE_BADGES.expense);
                      return (
                        <TableRow
                          key={tx.id}
                          className={`cursor-pointer ${isReimbursement || isInPot ? "opacity-60" : ""}`}
                          onClick={() => setSelectedTransaction(tx)}
                        >
                          <TableCell className="whitespace-nowrap text-sm">
                            <span className={isInPot ? "line-through" : ""}>{formatDate(tx.date)}</span>
                          </TableCell>
                          <TableCell className="max-w-[300px] text-sm font-medium">
                            <div className="flex items-center gap-1.5">
                              <span className={`truncate ${isInPot ? "line-through" : ""}`}>{tx.description}</span>
                              {tx.groupName && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 gap-0.5">
                                  <Package className="h-2.5 w-2.5" />
                                  {tx.groupName}
                                </Badge>
                              )}
                            </div>
                            {isReimbursement && tx.reimbursesDescription && (
                              <div className="text-xs text-muted-foreground truncate mt-0.5">
                                Reimburses: {tx.reimbursesDescription}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            <span className={isInPot ? "line-through" : ""}>{tx.accountName || "—"}</span>
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
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
                            <div className="flex items-center gap-1">
                              <Badge variant={typeInfo.variant} className="text-xs">
                                {isTransfer && tx.linkedAccountName
                                  ? `↔ Transfer → ${tx.linkedAccountName}`
                                  : typeInfo.label}
                              </Badge>
                              {hasReimbursements && (
                                <Badge variant="outline" className="text-xs gap-0.5">
                                  <Receipt className="h-3 w-3" />
                                  {tx.reimbursementCount}
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            {hasReimbursements ? (
                              <div>
                                <span className="font-mono text-sm font-medium text-red-600 dark:text-red-400">
                                  {formatCurrency(tx.effectiveAmount)}
                                </span>
                                <span className="block text-xs text-muted-foreground line-through">
                                  {formatCurrency(tx.amount)}
                                </span>
                              </div>
                            ) : (
                              <span
                                className={`font-mono text-sm font-medium ${isInPot ? "line-through " : ""}${
                                  isTransfer || isReimbursement || isInPot
                                    ? "text-muted-foreground"
                                    : tx.amount >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                                }`}
                              >
                                {tx.amount >= 0 ? "+" : ""}
                                {formatCurrency(tx.amount)}
                              </span>
                            )}
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <div className="flex gap-1">
                              {/* Add to pot action */}
                              {pots.length > 0 && !tx.groupId && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground hover:text-foreground transition-colors"
                                  title="Add to pot"
                                  onClick={() => setAddToPotTx(tx)}
                                >
                                  <Package className="h-3 w-3" />
                                </Button>
                              )}
                              {/* Remove from pot action */}
                              {tx.groupId && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground hover:text-foreground transition-colors"
                                  title="Remove from pot"
                                  onClick={() => {
                                    handleRemoveFromPot(tx.groupId!, tx.id);
                                  }}
                                >
                                  <Minus className="h-3 w-3" />
                                </Button>
                              )}
                              {/* Mark as reimbursement action for income transactions */}
                              {tx.type === "income" && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground hover:text-foreground transition-colors"
                                  title="Mark as reimbursement"
                                  onClick={() => setReimbursePicker(tx)}
                                >
                                  <Receipt className="h-3 w-3" />
                                </Button>
                              )}
                              {/* Unlink reimbursement action */}
                              {isReimbursement && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground hover:text-foreground transition-colors"
                                  title="Unlink reimbursement"
                                  onClick={() => handleUnlinkReimbursement(tx.id)}
                                >
                                  <Undo2 className="h-3 w-3" />
                                </Button>
                              )}
                              {deleteConfirm === tx.id ? (
                                <>
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
                                </>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground hover:text-destructive transition-colors"
                                  onClick={() => setDeleteConfirm(tx.id)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
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

      {/* Transaction Detail Modal */}
      <TransactionDetailDialog
        transaction={selectedTransaction}
        onOpenChange={(open) => { if (!open) setSelectedTransaction(null); }}
        categories={categories}
        onCategorized={() => { fetchTransactions(); }}
      />

      {/* Reimbursement Picker */}
      {reimbursePicker && (
        <ReimbursementPicker
          open={true}
          onOpenChange={(open) => { if (!open) setReimbursePicker(null); }}
          transactionId={reimbursePicker.id}
          transactionAmount={reimbursePicker.amount}
          transactionDescription={reimbursePicker.description}
          accountId={reimbursePicker.accountId}
          onLinked={fetchTransactions}
        />
      )}

      {/* Create Pot Dialog */}
      <CreatePotDialog
        open={createPotOpen}
        onOpenChange={setCreatePotOpen}
        categories={categories}
        onCreated={() => { fetchPots(); }}
      />

      {/* Add Transaction to Pot Dialog */}
      {addToPotTx && (
        <AddToPotDialog
          open={true}
          onOpenChange={(open) => { if (!open) setAddToPotTx(null); }}
          pots={pots}
          transactionDescription={addToPotTx.description}
          onSelect={async (potId) => {
            await handleAddToPot(potId, addToPotTx.id);
          }}
        />
      )}

      {/* Pot Transaction Picker */}
      {addToPotPicker && (
        <PotTransactionPicker
          open={true}
          onOpenChange={(open) => { if (!open) setAddToPotPicker(null); }}
          potId={addToPotPicker.id}
          potName={addToPotPicker.name}
          onAdded={() => {
            fetchPots();
            fetchTransactions();
          }}
        />
      )}
    </div>
  );
}
