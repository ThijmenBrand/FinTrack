"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AddToPotDialog } from "@/components/add-to-pot-dialog";
import { CsvUploadDialog } from "@/components/csv-upload-dialog";
import { TransactionDetailDialog } from "@/components/transaction-detail-dialog";
import { ReimbursementPicker } from "@/components/reimbursement-picker";
import { CreatePotDialog } from "@/components/create-pot-dialog";
import { EditPotDialog } from "@/components/edit-pot-dialog";
import { PotTransactionPicker } from "@/components/pot-transaction-picker";
import {
  Upload,
  ArrowLeftRight,
  Loader2,
  Plus,
  History,
} from "lucide-react";
import { useAccounts } from "@/hooks/use-accounts";
import { useCategories } from "@/hooks/use-categories";
import { usePots, useDeletePot, useAddToPot, useRemoveFromPot } from "@/hooks/use-pots";
import { useTransactions, useDeleteTransaction, useDetectTransfers, useDeleteReimbursement, useBulkCategorizeTransactions, useBulkDeleteTransactions } from "@/hooks/use-transactions";
import { formatDate } from "@/lib/utils";
import type { Transaction, Pot, Pagination } from "@/types/api";
import {
  TransactionSearchBar,
  computeDateRange,
  TYPE_OPTIONS,
} from "./_components/transaction-search-bar";
import { TransactionRow, PotRow } from "./_components/transaction-row";
import { TransactionTotals } from "./_components/transaction-totals";
import { TransactionBulkBar } from "./_components/transaction-bulk-bar";
import { TransactionsTable } from "./_components/transactions-table";

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

  // Reference data via React Query
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: pots = [] } = usePots();

  // Mutations
  const deleteTx = useDeleteTransaction();
  const detectTransfers = useDetectTransfers();
  const deleteReimbursement = useDeleteReimbursement();
  const deletePot = useDeletePot();
  const addToPot = useAddToPot();
  const removeFromPot = useRemoveFromPot();
  const bulkCategorize = useBulkCategorizeTransactions();
  const bulkDelete = useBulkDeleteTransactions();

  // Pagination state
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 0,
  });

  // UI state
  const [uploadOpen, setUploadOpen] = useState(
    () => searchParams.get("action") === "upload",
  );
  const [transferResult, setTransferResult] = useState<string | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [reimbursePicker, setReimbursePicker] = useState<Transaction | null>(null);
  const [createPotOpen, setCreatePotOpen] = useState(false);
  const [addToPotPicker, setAddToPotPicker] = useState<Pot | null>(null);
  const [editPot, setEditPot] = useState<Pot | null>(null);
  const [addToPotTx, setAddToPotTx] = useState<Transaction | null>(null);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPotOpen, setBulkPotOpen] = useState(false);

  // Filters — initialized from URL params
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [accountFilter, setAccountFilter] = useState(searchParams.get("account") || "all");
  const [categoryFilter, setCategoryFilter] = useState(searchParams.get("category") || "all");
  const [typeFilter, setTypeFilter] = useState(searchParams.get("type") || "all");
  const [periodFilter, setPeriodFilter] = useState(searchParams.get("period") || "all");
  const [dateFromOverride, setDateFromOverride] = useState(searchParams.get("dateFrom") || "");
  const [dateToOverride, setDateToOverride] = useState(searchParams.get("dateTo") || "");
  const [sortBy, setSortBy] = useState(searchParams.get("sortBy") || "date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">((searchParams.get("sortOrder") as "asc" | "desc") || "desc");

  const hasActiveFilters =
    accountFilter !== "all" ||
    categoryFilter !== "all" ||
    typeFilter !== "all" ||
    periodFilter !== "all" ||
    !!dateFromOverride ||
    !!dateToOverride ||
    !!search;

  // Sync filters to URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (accountFilter !== "all") params.set("account", accountFilter);
    if (categoryFilter !== "all") params.set("category", categoryFilter);
    if (typeFilter !== "all") params.set("type", typeFilter);
    if (periodFilter !== "all") params.set("period", periodFilter);
    if (dateFromOverride) params.set("dateFrom", dateFromOverride);
    if (dateToOverride) params.set("dateTo", dateToOverride);
    if (sortBy !== "date") params.set("sortBy", sortBy);
    if (sortOrder !== "desc") params.set("sortOrder", sortOrder);
    const qs = params.toString();
    const newUrl = qs ? `/transactions?${qs}` : "/transactions";
    router.replace(newUrl, { scroll: false });
  }, [search, accountFilter, categoryFilter, typeFilter, periodFilter, dateFromOverride, dateToOverride, sortBy, sortOrder, router]);

  // Compute dateFrom/dateTo — URL overrides win over period preset
  const { from: dateFrom, to: dateTo } = useMemo(() => {
    if (dateFromOverride || dateToOverride) {
      return { from: dateFromOverride, to: dateToOverride };
    }
    return computeDateRange(periodFilter);
  }, [periodFilter, dateFromOverride, dateToOverride]);

  // Transaction data via React Query
  const { data: txData, isLoading: loading } = useTransactions({
    page: pagination.page,
    limit: pagination.limit,
    sortBy,
    sortOrder,
    search: search || undefined,
    accountId: accountFilter !== "all" ? accountFilter : undefined,
    categoryId: categoryFilter !== "all" ? categoryFilter : undefined,
    type: typeFilter !== "all" ? typeFilter : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });
  const transactions = txData?.data ?? [];
  const distinctTypes = txData?.distinctTypes ?? [];
  const totals = txData?.totals ?? null;

  // Show the live row from the query cache so the open detail dialog reflects
  // categorize/link mutations; fall back to the snapshot if it left the page.
  const liveSelectedTransaction = selectedTransaction
    ? transactions.find((t) => t.id === selectedTransaction.id) ?? selectedTransaction
    : null;

  // Sync pagination from query response
  useEffect(() => {
    if (txData?.pagination) {
      setPagination(txData.pagination);
    }
  }, [txData?.pagination]);

  const applyFilter = (key: string, value: string) => {
    if (key === "account") setAccountFilter(value);
    else if (key === "category") setCategoryFilter(value);
    else if (key === "type") setTypeFilter(value);
    else if (key === "period") {
      setPeriodFilter(value);
      setDateFromOverride("");
      setDateToOverride("");
    }
    else if (key === "search") setSearch(value);
    setPagination((p) => ({ ...p, page: 1 }));
  };

  const removeFilter = (key: string) => {
    if (key === "account") setAccountFilter("all");
    else if (key === "category") setCategoryFilter("all");
    else if (key === "type") setTypeFilter("all");
    else if (key === "period") {
      setPeriodFilter("all");
      setDateFromOverride("");
      setDateToOverride("");
    }
    else if (key === "search") setSearch("");
    setPagination((p) => ({ ...p, page: 1 }));
  };

  const clearAllFilters = () => {
    setAccountFilter("all");
    setCategoryFilter("all");
    setTypeFilter("all");
    setPeriodFilter("all");
    setDateFromOverride("");
    setDateToOverride("");
    setSearch("");
    setPagination((p) => ({ ...p, page: 1 }));
  };

  const handleRemoveFromPot = async (potId: string, transactionId: string) => {
    try {
      await removeFromPot.mutateAsync({ potId, transactionId });
    } catch (err) {
      console.error("Failed to remove from pot:", err);
    }
  };

  const handleDeletePot = async (potId: string) => {
    try {
      await deletePot.mutateAsync(potId);
    } catch (err) {
      console.error("Failed to delete pot:", err);
    }
  };

  const handleAddToPot = async (potId: string, transactionId: string) => {
    try {
      await addToPot.mutateAsync({ potId, transactionId });
    } catch (err) {
      console.error("Failed to add to pot:", err);
    }
  };

  const handleDetectTransfers = async () => {
    setTransferResult(null);
    try {
      const data = await detectTransfers.mutateAsync();
      if (data.success) {
        setTransferResult(
          data.matchedPairs > 0
            ? `Found ${data.matchedPairs} transfer pair${data.matchedPairs !== 1 ? "s" : ""} (${data.totalTransactionsUpdated} transactions updated)`
            : "No new internal transfers detected"
        );
      }
    } catch (err) {
      console.error("Failed to detect transfers:", err);
    }
  };

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
    await deleteTx.mutateAsync(id);
  };

  const handleUnlinkReimbursement = async (id: string) => {
    await deleteReimbursement.mutateAsync(id);
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

  // Bulk selection — intersect with the current page so stale ids from other
  // pages/filters are ignored without needing cleanup effects.
  const selectedOnPage = transactions.filter((t) => selectedIds.has(t.id));
  const allOnPageSelected =
    transactions.length > 0 && selectedOnPage.length === transactions.length;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds(
      allOnPageSelected ? new Set() : new Set(transactions.map((t) => t.id))
    );
  };

  const handleBulkCategorize = async (value: string) => {
    await bulkCategorize.mutateAsync({
      transactionIds: selectedOnPage.map((t) => t.id),
      categoryId: value === "none" ? null : value,
    });
    setSelectedIds(new Set());
  };

  const handleBulkDelete = async () => {
    await bulkDelete.mutateAsync(selectedOnPage.map((t) => t.id));
    setSelectedIds(new Set());
  };

  // Render pot/transaction rows for a given layout — used by both the desktop
  // table and the mobile card list.
  const renderItems = (layout: "table" | "card") =>
    displayItems.map((item) =>
      item.kind === "pot" ? (
        <PotRow
          key={`pot-${item.data.id}`}
          pot={item.data}
          layout={layout}
          categories={categories}
          onAddTransactions={() => setAddToPotPicker(item.data)}
          onEdit={() => setEditPot(item.data)}
          onDelete={() => handleDeletePot(item.data.id)}
        />
      ) : (
        <TransactionRow
          key={item.data.id}
          tx={item.data}
          layout={layout}
          categories={categories}
          selected={selectedIds.has(item.data.id)}
          hasPots={pots.length > 0}
          onToggleSelect={() => toggleSelect(item.data.id)}
          onOpen={() => setSelectedTransaction(item.data)}
          onAddToPot={() => setAddToPotTx(item.data)}
          onRemoveFromPot={() => handleRemoveFromPot(item.data.groupId!, item.data.id)}
          onReimburse={() => setReimbursePicker(item.data)}
          onUnlinkReimbursement={() => handleUnlinkReimbursement(item.data.id)}
          onDelete={() => handleDelete(item.data.id)}
        />
      )
    );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Transactions</h1>
          <p className="text-muted-foreground">
            View, filter, and manage your transactions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCreatePotOpen(true)}>
            <Plus className="sm:mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Create Pot</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDetectTransfers}
            disabled={detectTransfers.isPending}
          >
            {detectTransfers.isPending ? (
              <Loader2 className="sm:mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ArrowLeftRight className="sm:mr-2 h-4 w-4" />
            )}
            <span className="hidden sm:inline">Detect Transfers</span>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href="/import-history">
              <History className="sm:mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Import History</span>
            </Link>
          </Button>
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Upload className="sm:mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Import CSV</span>
          </Button>
        </div>
      </div>

      {/* GitHub-style Filter Bar */}
      <TransactionSearchBar
        search={search}
        accountFilter={accountFilter}
        categoryFilter={categoryFilter}
        typeFilter={typeFilter}
        periodFilter={periodFilter}
        dateFromOverride={dateFromOverride}
        dateToOverride={dateToOverride}
        accounts={accounts}
        categories={categories}
        distinctTypes={distinctTypes}
        onApply={applyFilter}
        onRemove={removeFilter}
        onClearAll={clearAllFilters}
      />

      {/* Active filter summary with date range */}
      {(periodFilter !== "all" || dateFromOverride || dateToOverride) && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            Showing: {dateFrom && formatDate(dateFrom)}
            {dateTo ? ` — ${formatDate(dateTo)}` : " — now"}
          </span>
        </div>
      )}

      {/* Cumulative Totals Summary */}
      {hasActiveFilters && totals && <TransactionTotals totals={totals} />}

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

      {/* Bulk Action Bar */}
      {selectedOnPage.length > 0 && (
        <TransactionBulkBar
          count={selectedOnPage.length}
          categories={categories}
          canAddToPot={pots.length > 0 && selectedOnPage.some((t) => !t.groupId)}
          categorizePending={bulkCategorize.isPending}
          deletePending={bulkDelete.isPending}
          onCategorize={handleBulkCategorize}
          onAddToPot={() => setBulkPotOpen(true)}
          onDelete={handleBulkDelete}
          onClear={() => setSelectedIds(new Set())}
        />
      )}

      {/* Data Table */}
      <TransactionsTable
        pagination={pagination}
        setPagination={setPagination}
        loading={loading}
        rowCount={transactions.length}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearAllFilters}
        onUpload={() => setUploadOpen(true)}
        allSelected={allOnPageSelected}
        onToggleSelectAll={toggleSelectAll}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSort={handleSort}
        accountOptions={accountOptions}
        categoryOptions={categoryOptions}
        typeOptions={availableTypeOptions}
        accountFilter={accountFilter}
        categoryFilter={categoryFilter}
        typeFilter={typeFilter}
        onAccountChange={(v) => { setAccountFilter(v); setPagination((p) => ({ ...p, page: 1 })); }}
        onCategoryChange={(v) => { setCategoryFilter(v); setPagination((p) => ({ ...p, page: 1 })); }}
        onTypeChange={(v) => { setTypeFilter(v); setPagination((p) => ({ ...p, page: 1 })); }}
        renderRows={renderItems}
      />

      {/* CSV Upload Dialog */}
      <CsvUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        accounts={accounts}
      />

      {/* Transaction Detail Modal */}
      <TransactionDetailDialog
        transaction={liveSelectedTransaction}
        onOpenChange={(open) => { if (!open) setSelectedTransaction(null); }}
        categories={categories}
      />

      {/* Reimbursement Picker */}
      {reimbursePicker && (
        <ReimbursementPicker
          open={true}
          onOpenChange={(open) => { if (!open) setReimbursePicker(null); }}
          transactionId={reimbursePicker.id}
          transactionAmount={reimbursePicker.amount}
          transactionDescription={reimbursePicker.description}
          transactionDate={reimbursePicker.date}
          accountId={reimbursePicker.accountId}
        />
      )}

      {/* Create Pot Dialog */}
      <CreatePotDialog
        open={createPotOpen}
        onOpenChange={setCreatePotOpen}
        categories={categories}
      />

      {/* Edit Pot Dialog */}
      <EditPotDialog
        open={!!editPot}
        onOpenChange={(open) => { if (!open) setEditPot(null); }}
        categories={categories}
        pot={editPot}
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

      {/* Bulk Add to Pot Dialog */}
      {bulkPotOpen && (
        <AddToPotDialog
          open={true}
          onOpenChange={(open) => { if (!open) setBulkPotOpen(false); }}
          pots={pots}
          transactionDescription={`${selectedOnPage.length} selected transactions`}
          onSelect={async (potId) => {
            for (const tx of selectedOnPage) {
              if (!tx.groupId) await addToPot.mutateAsync({ potId, transactionId: tx.id });
            }
            setSelectedIds(new Set());
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
        />
      )}
    </div>
  );
}
