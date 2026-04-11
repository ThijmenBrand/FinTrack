import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { AuditLogResponse, AuditLogFilters } from "@/types/api";

function buildParams(filters: AuditLogFilters): string {
  const params = new URLSearchParams();
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.category) params.set("category", filters.category);
  if (filters.action) params.set("action", filters.action);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  return params.toString();
}

export function useAuditLogs(filters: AuditLogFilters) {
  return useQuery({
    queryKey: ["audit-logs", filters],
    queryFn: () => apiFetch<AuditLogResponse>(`/api/admin/audit-logs?${buildParams(filters)}`),
  });
}

export function useCleanupAuditLogs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch("/api/admin/audit-logs", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["audit-logs"] }); },
  });
}
