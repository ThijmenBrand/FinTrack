"use client";

import {
  useCallback,
  useEffect,
  useState,
  useMemo,
  useRef,
  Suspense,
  type Dispatch,
  type SetStateAction,
} from "react";
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
import { usePots, useDeletePot, useAddToPot, useRemoveFromPot, useCreatePot } from "@/hooks/use-pots";
import { useTransactions, useDeleteTransaction, useDetectTransfers, useDeleteReimbursement, useBulkCategorizeTransactions, useBulkDeleteTransactions } from "@/hooks/use-transactions";
import { usePreferences } from "@/hooks/use-preferences";
import type { Transaction, Pot, Pagination, PotRangeTotal } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";
import {
  TransactionSearchBar,
  computeDateRange,
  TYPE_OPTIONS,
} from "./_components/transaction-search-bar";
import { TransactionRow, PotRow } from "./_components/transaction-row";
import {
  TransactionContextMenu,
  TransactionNoteDialog,
  type ContextMenuState,
} from "./_components/transaction-context-menu";
import { TransactionTotals } from "./_components/transaction-totals";
import { TransactionBulkBar } from "./_components/transaction-bulk-bar";
import { TransactionsTable } from "./_components/transactions-table";
import { SimpleTransactionList } from "./_components/simple-transaction-list";

// --- Main Page ---
export default function TransactionsPageWrapper() {
  return (
    <Suspense>
      <TransactionsPage />
    </Suspense>
  );
}

function TransactionsPage() {
  const { t, plural, formatDate } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Reference data via React Query
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: pots = [] } = usePots();
  const { data: preferences } = usePreferences();
  // Simple mode: the totals, then the list — name, date, category, amount,
  // with one dropdown each for period, category and type. No query syntax, no
  // sorting, no bulk actions, no pots and no transfer detection.
  const simple = preferences?.simpleMode ?? false;

  // Mutations
  const deleteTx = useDeleteTransaction();
  const detectTransfers = useDetectTransfers();
  const deleteReimbursement = useDeleteReimbursement();
  const deletePot = useDeletePot();
  const addToPot = useAddToPot();
  const removeFromPot = useRemoveFromPot();
  const createPot = useCreatePot();
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
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [noteTx, setNoteTx] = useState<Transaction | null>(null);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPotOpen, setBulkPotOpen] = useState(false);
  // Sequential "mark as reimbursement" — walk each selected income tx through the
  // picker one at a time; head of the queue is the active one.
  const [reimburseQueue, setReimburseQueue] = useState<Transaction[]>([]);
  const bulkLinkedRef = useRef(false);

  // Filters — initialized from URL params
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [accountFilter, setAccountFilter] = useState(searchParams.get("account") || "all");
  const [potFilter, setPotFilter] = useState(searchParams.get("pot") || "all");
  const [categoryFilters, setCategoryFilters] = useState<string[]>(() => searchParams.getAll("category"));
  const [excludeCategories, setExcludeCategories] = useState<string[]>(() => searchParams.getAll("excludeCategory"));
  const [excludeTypes, setExcludeTypes] = useState<string[]>(() => searchParams.getAll("excludeType"));
  const [typeFilters, setTypeFilters] = useState<string[]>(() => searchParams.getAll("type"));
  const [periodFilter, setPeriodFilter] = useState(searchParams.get("period") || "all");
  const [dateFromOverride, setDateFromOverride] = useState(searchParams.get("dateFrom") || "");
  const [dateToOverride, setDateToOverride] = useState(searchParams.get("dateTo") || "");
  const [sortBy, setSortBy] = useState(searchParams.get("sortBy") || "date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">((searchParams.get("sortOrder") as "asc" | "desc") || "desc");

  const hasActiveFilters =
    accountFilter !== "all" ||
    potFilter !== "all" ||
    categoryFilters.length > 0 ||
    typeFilters.length > 0 ||
    periodFilter !== "all" ||
    !!dateFromOverride ||
    !!dateToOverride ||
    excludeCategories.length > 0 ||
    excludeTypes.length > 0 ||
    !!search;

  // Sync filters to URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (accountFilter !== "all") params.set("account", accountFilter);
    if (potFilter !== "all") params.set("pot", potFilter);
    categoryFilters.forEach((id) => params.append("category", id));
    typeFilters.forEach((t) => params.append("type", t));
    if (periodFilter !== "all") params.set("period", periodFilter);
    if (dateFromOverride) params.set("dateFrom", dateFromOverride);
    if (dateToOverride) params.set("dateTo", dateToOverride);
    excludeCategories.forEach((id) => params.append("excludeCategory", id));
    excludeTypes.forEach((t) => params.append("excludeType", t));
    if (sortBy !== "date") params.set("sortBy", sortBy);
    if (sortOrder !== "desc") params.set("sortOrder", sortOrder);
    const qs = params.toString();
    const newUrl = qs ? `/transactions?${qs}` : "/transactions";
    router.replace(newUrl, { scroll: false });
  }, [search, accountFilter, potFilter, categoryFilters, typeFilters, periodFilter, dateFromOverride, dateToOverride, excludeCategories, excludeTypes, sortBy, sortOrder, router]);

  // The "hide internal transfers" preference excludes that type from the query
  // without showing up as a removable filter chip. Asking for transfers
  // explicitly (a money-flow leg, a type chip) beats the preference — otherwise
  // the list comes back empty with nothing on screen explaining why.
  const queryExcludeTypes = useMemo(() => {
    if (!preferences?.hideInternalTransfers) return excludeTypes;
    if (typeFilters.includes("internal_transfer")) return excludeTypes;
    return excludeTypes.includes("internal_transfer")
      ? excludeTypes
      : [...excludeTypes, "internal_transfer"];
  }, [excludeTypes, typeFilters, preferences?.hideInternalTransfers]);

  // Compute dateFrom/dateTo — URL overrides win over period preset
  const { from: dateFrom, to: dateTo } = useMemo(() => {
    if (dateFromOverride || dateToOverride) {
      return { from: dateFromOverride, to: dateToOverride };
    }
    return computeDateRange(periodFilter);
  }, [periodFilter, dateFromOverride, dateToOverride]);

  // Transaction data via React Query
  const { data: txData, isLoading: loading, isPlaceholderData: fetching } = useTransactions({
    page: pagination.page,
    limit: pagination.limit,
    sortBy,
    sortOrder,
    search: search || undefined,
    accountId: accountFilter !== "all" ? accountFilter : undefined,
    groupId: potFilter !== "all" ? potFilter : undefined,
    categoryIds: categoryFilters.length ? categoryFilters : undefined,
    excludeCategoryIds: excludeCategories.length ? excludeCategories : undefined,
    excludeTypes: queryExcludeTypes.length ? queryExcludeTypes : undefined,
    types: typeFilters.length ? typeFilters : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });
  const transactions = txData?.data ?? [];
  const distinctTypes = txData?.distinctTypes ?? [];
  const totals = txData?.totals ?? null;

  // Per-pot net for the filtered range. The pot row shows this instead of the
  // pot's lifetime net, so it reconciles with the totals card above it.
  const potTotalsById = useMemo(() => {
    const map = new Map<string, PotRangeTotal>();
    for (const pt of txData?.potTotals ?? []) map.set(pt.groupId, pt);
    return map;
  }, [txData?.potTotals]);

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

  // Toggle a value in a multi-select include filter; "all" clears it entirely.
  const toggleInclude = (setter: typeof setCategoryFilters, value: string) => {
    if (value === "all") setter([]);
    else setter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
    setPagination((p) => ({ ...p, page: 1 }));
  };

  const applyFilter = (key: string, value: string) => {
    if (key === "account") setAccountFilter(value);
    else if (key === "pot") setPotFilter(value);
    else if (key === "category") setCategoryFilters((prev) => (prev.includes(value) ? prev : [...prev, value]));
    else if (key === "type") setTypeFilters((prev) => (prev.includes(value) ? prev : [...prev, value]));
    else if (key === "period") {
      setPeriodFilter(value);
      setDateFromOverride("");
      setDateToOverride("");
    }
    else if (key === "search") setSearch(value);
    setPagination((p) => ({ ...p, page: 1 }));
  };

  const removeFilter = (key: string, value?: string) => {
    if (key === "account") setAccountFilter("all");
    else if (key === "pot") setPotFilter("all");
    else if (key === "category") setCategoryFilters((prev) => prev.filter((v) => v !== value));
    else if (key === "type") setTypeFilters((prev) => prev.filter((v) => v !== value));
    else if (key === "period") {
      setPeriodFilter("all");
      setDateFromOverride("");
      setDateToOverride("");
    }
    else if (key === "search") setSearch("");
    setPagination((p) => ({ ...p, page: 1 }));
  };

  const applyExclude = (key: "category" | "type", value: string) => {
    const setter = key === "category" ? setExcludeCategories : setExcludeTypes;
    setter((prev) => (prev.includes(value) ? prev : [...prev, value]));
    setPagination((p) => ({ ...p, page: 1 }));
  };

  const removeExclude = (key: "category" | "type", value: string) => {
    const setter = key === "category" ? setExcludeCategories : setExcludeTypes;
    setter((prev) => prev.filter((v) => v !== value));
    setPagination((p) => ({ ...p, page: 1 }));
  };

  const clearAllFilters = () => {
    setAccountFilter("all");
    setPotFilter("all");
    setCategoryFilters([]);
    setTypeFilters([]);
    setPeriodFilter("all");
    setDateFromOverride("");
    setDateToOverride("");
    setExcludeCategories([]);
    setExcludeTypes([]);
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

  const handleCreatePot = async (name: string) => {
    const { id } = await createPot.mutateAsync({ name, categoryId: null }) as { id: string };
    return id;
  };

  const handleDetectTransfers = async () => {
    setTransferResult(null);
    try {
      const data = await detectTransfers.mutateAsync();
      if (data.success) {
        setTransferResult(
          data.matchedPairs > 0
            ? plural(data.matchedPairs, "tx.transfersFound.one", "tx.transfersFound.other", {
                updated: data.totalTransactionsUpdated,
              })
            : t("tx.transfersNone"),
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
  const availableTypeOptions = TYPE_OPTIONS.filter((o) =>
    distinctTypes.includes(o.value),
  ).map((o) => ({ value: o.value, label: t(o.labelKey) }));

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
          rangeTotal={potTotalsById.get(item.data.id)}
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
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY, tx: item.data });
          }}
        />
      )
    );

  const handleSimpleSearch = useCallback((value: string) => {
    setSearch(value);
    setPagination((p) => ({ ...p, page: 1 }));
  }, []);

  // Simple mode filters are single-select; "all" clears the underlying list.
  const setSingleFilter = (
    setter: Dispatch<SetStateAction<string[]>>,
    value: string,
  ) => {
    setter(value === "all" ? [] : [value]);
    setPagination((p) => ({ ...p, page: 1 }));
  };

  if (simple) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t("tx.title")}</h1>
            <p className="text-muted-foreground">{t("tx.simple.subtitle")}</p>
          </div>
          <Button data-tour="import-csv" size="sm" onClick={() => setUploadOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            {t("tx.importCsv")}
          </Button>
        </div>

        {totals && <TransactionTotals totals={totals} />}

        <SimpleTransactionList
          transactions={transactions}
          pagination={pagination}
          setPagination={setPagination}
          loading={loading}
          fetching={fetching}
          search={search}
          onSearchChange={handleSimpleSearch}
          period={periodFilter}
          onPeriodChange={(value) => {
            setPeriodFilter(value);
            setDateFromOverride("");
            setDateToOverride("");
            setPagination((p) => ({ ...p, page: 1 }));
          }}
          category={categoryFilters[0] ?? "all"}
          onCategoryChange={(value) => setSingleFilter(setCategoryFilters, value)}
          categories={categories}
          type={typeFilters[0] ?? "all"}
          onTypeChange={(value) => setSingleFilter(setTypeFilters, value)}
          typeOptions={availableTypeOptions}
          onOpen={setSelectedTransaction}
          onUpload={() => setUploadOpen(true)}
        />

        <CsvUploadDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          accounts={accounts}
        />

        <TransactionDetailDialog
          transaction={liveSelectedTransaction}
          onOpenChange={(open) => { if (!open) setSelectedTransaction(null); }}
          categories={categories}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("tx.title")}</h1>
          <p className="text-muted-foreground">{t("tx.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCreatePotOpen(true)}>
            <Plus className="sm:mr-2 h-4 w-4" />
            <span className="hidden sm:inline">{t("tx.createPot")}</span>
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
            <span className="hidden sm:inline">{t("tx.detectTransfers")}</span>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href="/import-history">
              <History className="sm:mr-2 h-4 w-4" />
              <span className="hidden sm:inline">{t("tx.importHistory")}</span>
            </Link>
          </Button>
          <Button data-tour="import-csv" size="sm" onClick={() => setUploadOpen(true)}>
            <Upload className="sm:mr-2 h-4 w-4" />
            <span className="hidden sm:inline">{t("tx.importCsv")}</span>
          </Button>
        </div>
      </div>

      {/* GitHub-style Filter Bar */}
      <TransactionSearchBar
        search={search}
        accountFilter={accountFilter}
        categoryFilters={categoryFilters}
        typeFilters={typeFilters}
        potFilter={potFilter}
        periodFilter={periodFilter}
        dateFromOverride={dateFromOverride}
        dateToOverride={dateToOverride}
        excludeCategories={excludeCategories}
        excludeTypes={excludeTypes}
        accounts={accounts}
        categories={categories}
        pots={pots}
        distinctTypes={distinctTypes}
        onApply={applyFilter}
        onRemove={removeFilter}
        onApplyExclude={applyExclude}
        onRemoveExclude={removeExclude}
        onClearAll={clearAllFilters}
      />

      {/* Active filter summary with date range */}
      {(periodFilter !== "all" || dateFromOverride || dateToOverride) && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {t("tx.showingRange", { from: dateFrom ? formatDate(dateFrom) : "" })}
            {dateTo ? ` — ${formatDate(dateTo)}` : ` — ${t("tx.rangeToNow")}`}
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
            {t("tx.dismiss")}
          </Button>
        </div>
      )}

      {/* Bulk Action Bar */}
      {selectedOnPage.length > 0 && (
        <TransactionBulkBar
          count={selectedOnPage.length}
          categories={categories}
          canAddToPot={pots.length > 0 && selectedOnPage.some((t) => !t.groupId)}
          canReimburse={selectedOnPage.some((t) => t.type === "income")}
          categorizePending={bulkCategorize.isPending}
          deletePending={bulkDelete.isPending}
          onCategorize={handleBulkCategorize}
          onAddToPot={() => setBulkPotOpen(true)}
          onReimburse={() => setReimburseQueue(selectedOnPage.filter((t) => t.type === "income"))}
          onDelete={handleBulkDelete}
          onClear={() => setSelectedIds(new Set())}
        />
      )}

      {/* Data Table */}
      <TransactionsTable
        pagination={pagination}
        setPagination={setPagination}
        loading={loading}
        fetching={fetching}
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
        accountFilter={accountFilter === "all" ? [] : accountFilter.split(",")}
        categoryFilter={categoryFilters}
        typeFilter={typeFilters}
        onAccountChange={(v) => {
          setAccountFilter((prev) => {
            if (v === "all") return "all";
            const ids = prev === "all" ? [] : prev.split(",");
            const next = ids.includes(v) ? ids.filter((id) => id !== v) : [...ids, v];
            return next.length ? next.join(",") : "all";
          });
          setPagination((p) => ({ ...p, page: 1 }));
        }}
        onCategoryChange={(v) => toggleInclude(setCategoryFilters, v)}
        onTypeChange={(v) => toggleInclude(setTypeFilters, v)}
        renderRows={renderItems}
      />

      {/* Right-click Context Menu */}
      <TransactionContextMenu
        menu={contextMenu}
        categories={categories}
        onClose={() => setContextMenu(null)}
        onAddNote={setNoteTx}
        onAddToPot={setAddToPotTx}
        onRemoveFromPot={(tx) => handleRemoveFromPot(tx.groupId!, tx.id)}
        onReimburse={setReimbursePicker}
        onDelete={(tx) => {
          if (window.confirm(t("tx.confirmDelete"))) handleDelete(tx.id);
        }}
        onFilterByCategory={(tx) => { if (tx.categoryId) applyFilter("category", tx.categoryId); }}
        onFilterByName={(tx) => applyFilter("search", tx.name || tx.description)}
      />

      {/* Note Editor Dialog */}
      {noteTx && (
        <TransactionNoteDialog tx={noteTx} onClose={() => setNoteTx(null)} />
      )}

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

      {/* Bulk Reimbursement Picker — one transaction at a time */}
      {reimburseQueue.length > 0 && (
        <ReimbursementPicker
          key={reimburseQueue[0].id}
          open={true}
          transactionId={reimburseQueue[0].id}
          transactionAmount={reimburseQueue[0].amount}
          transactionDescription={reimburseQueue[0].description}
          transactionDate={reimburseQueue[0].date}
          accountId={reimburseQueue[0].accountId}
          onLinked={() => { bulkLinkedRef.current = true; }}
          onOpenChange={(open) => {
            if (open) return;
            // Linked → advance to the next queued tx; cancelled → abort the whole run.
            if (bulkLinkedRef.current) {
              bulkLinkedRef.current = false;
              if (reimburseQueue.length <= 1) setSelectedIds(new Set());
              setReimburseQueue((q) => q.slice(1));
            } else {
              setReimburseQueue([]);
            }
          }}
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
          onCreate={handleCreatePot}
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
          transactionDescription={t("tx.selectedTransactions", { count: selectedOnPage.length })}
          onCreate={handleCreatePot}
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
