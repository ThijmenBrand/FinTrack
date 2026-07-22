"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Upload,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
} from "lucide-react";
import { HeaderFilterDropdown, SortArrow } from "./header-filter-dropdown";
import type { Pagination } from "@/types/api";

type Option = { value: string; label: string; color?: string | null };

interface TransactionsTableProps {
  pagination: Pagination;
  setPagination: Dispatch<SetStateAction<Pagination>>;
  loading: boolean;
  fetching: boolean;
  rowCount: number;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  onUpload: () => void;
  allSelected: boolean;
  onToggleSelectAll: () => void;
  sortBy: string;
  sortOrder: "asc" | "desc";
  onSort: (col: string) => void;
  accountOptions: Option[];
  categoryOptions: Option[];
  typeOptions: Option[];
  accountFilter: string;
  categoryFilter: string[];
  typeFilter: string[];
  onAccountChange: (v: string) => void;
  onCategoryChange: (v: string) => void;
  onTypeChange: (v: string) => void;
  renderRows: (layout: "table" | "card") => ReactNode;
}

export function TransactionsTable({
  pagination,
  setPagination,
  loading,
  fetching,
  rowCount,
  hasActiveFilters,
  onClearFilters,
  onUpload,
  allSelected,
  onToggleSelectAll,
  sortBy,
  sortOrder,
  onSort,
  accountOptions,
  categoryOptions,
  typeOptions,
  accountFilter,
  categoryFilter,
  typeFilter,
  onAccountChange,
  onCategoryChange,
  onTypeChange,
  renderRows,
}: TransactionsTableProps) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-medium">
          {pagination.total} transaction{pagination.total !== 1 ? "s" : ""}
        </h2>
        <div className="flex items-center gap-3">
          <Select
          value={String(pagination.limit)}
          onValueChange={(v) =>
            setPagination((p) => ({ ...p, limit: Number(v), page: 1 }))
          }
        >
          <SelectTrigger className="w-[100px] hidden sm:flex">
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
      </div>

      {loading && rowCount === 0 ? (
        <div className="space-y-px">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : rowCount === 0 ? (
        <div className="flex flex-col items-center justify-center px-4 py-16">
          <FileSpreadsheet className="h-16 w-16 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium text-muted-foreground mb-1">
              No transactions found
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {hasActiveFilters
                ? "Try adjusting your filters."
                : "Import a CSV bank statement to get started."}
            </p>
            {hasActiveFilters ? (
            <Button variant="outline" onClick={onClearFilters}>
              Clear Filters
            </Button>
          ) : (
            <Button onClick={onUpload}>
              <Upload className="mr-2 h-4 w-4" />
              Import CSV
            </Button>
          )}
        </div>
      ) : (
        <div
          aria-busy={fetching}
          className={
            fetching ? "opacity-50 transition-opacity pointer-events-none" : "transition-opacity"
          }
        >
          {/* Desktop Table View */}
          <div className="hidden md:block">
            <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[36px]">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={onToggleSelectAll}
                        aria-label="Select all on page"
                      />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none whitespace-nowrap"
                      onClick={() => onSort("date")}
                    >
                      <span className="flex items-center">
                        Date
                        <SortArrow active={sortBy === "date"} order={sortOrder} />
                      </span>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => onSort("description")}
                    >
                      <span className="flex items-center">
                        Description
                        <SortArrow active={sortBy === "description"} order={sortOrder} />
                      </span>
                    </TableHead>
                    <TableHead className="select-none hidden sm:table-cell">
                      <HeaderFilterDropdown
                        label="Account"
                        options={accountOptions}
                        value={accountFilter}
                        onChange={onAccountChange}
                      />
                    </TableHead>
                    <TableHead className="select-none">
                      <HeaderFilterDropdown
                        label="Category"
                        options={categoryOptions}
                        value={categoryFilter}
                        onChange={onCategoryChange}
                      />
                    </TableHead>
                    <TableHead className="select-none hidden sm:table-cell">
                      <HeaderFilterDropdown
                        label="Type"
                        options={typeOptions}
                        value={typeFilter}
                        onChange={onTypeChange}
                      />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none text-right whitespace-nowrap"
                      onClick={() => onSort("amount")}
                    >
                      <span className="flex items-center justify-end">
                        Amount
                        <SortArrow active={sortBy === "amount"} order={sortOrder} />
                      </span>
                    </TableHead>
                    <TableHead className="w-[50px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>{renderRows("table")}</TableBody>
              </Table>
            </div>

            {/* Mobile List View */}
            <div className="md:hidden divide-y">
              {renderRows("card")}
            </div>

            {/* Pagination */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2 border-t px-4 py-3">
              <p className="text-xs sm:text-sm text-muted-foreground">
                Showing {(pagination.page - 1) * pagination.limit + 1}–
                {Math.min(pagination.page * pagination.limit, pagination.total)}{" "}
                of {pagination.total}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page <= 1}
                  onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span className="hidden sm:inline">Previous</span>
                </Button>
                <span className="text-xs sm:text-sm text-muted-foreground px-2">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
                >
                  <span className="hidden sm:inline">Next</span>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
        </div>
      )}
    </div>
  );
}
