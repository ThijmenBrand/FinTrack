import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Transaction, Pagination } from "@/types/api";

interface TransactionFilters {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
  search?: string;
  accountId?: string;
  categoryId?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  uncategorized?: boolean;
}

interface TransactionsResponse {
  data: Transaction[];
  pagination: Pagination;
  distinctTypes?: string[];
  totals?: { income: number; expense: number; transfers: number; reimbursements: number; net: number };
}

export function useTransactions(filters: TransactionFilters) {
  const params = new URLSearchParams();
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.sortBy) params.set("sortBy", filters.sortBy);
  if (filters.sortOrder) params.set("sortOrder", filters.sortOrder);
  if (filters.search) params.set("search", filters.search);
  if (filters.accountId) params.set("accountId", filters.accountId);
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.type) params.set("type", filters.type);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.uncategorized) params.set("uncategorized", "true");

  return useQuery({
    queryKey: ["transactions", filters],
    queryFn: () => apiFetch<TransactionsResponse>(`/api/transactions?${params}`),
    staleTime: 15 * 1000,
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/api/transactions?id=${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
    },
  });
}

export function useDetectTransfers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ success: boolean; matchedPairs: number; totalTransactionsUpdated: number }>("/api/transactions/detect-transfers", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["transactions"] }); },
  });
}

export function useCategorizeTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { transactionId: string; categoryId: string | null; createRule?: boolean; rulePattern?: string; ruleMatchType?: string }) =>
      apiFetch("/api/transactions/categorize", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
    },
  });
}

export function useReimburseTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { transactionId: string; expenseIds: string[] }) =>
      apiFetch("/api/transactions/reimburse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["transactions"] }); },
  });
}

export function useDeleteReimbursement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/api/transactions/reimburse?id=${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["transactions"] }); },
  });
}
