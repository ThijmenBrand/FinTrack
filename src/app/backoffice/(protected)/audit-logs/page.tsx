"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollText, ChevronLeft, ChevronRight, Trash2, Download } from "lucide-react";
import { useAuditLogs, useCleanupAuditLogs } from "@/hooks/use-audit-logs";
import { useAdminUsers } from "@/hooks/use-admin";
import type { AuditLogFilters, AuditLogEntry } from "@/types/api";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";

const CATEGORY_COLORS: Record<string, string> = {
  auth: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  data: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  admin: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

function formatAction(action: string): string {
  return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function DetailsCell({ details }: { details: Record<string, unknown> | null }) {
  const [expanded, setExpanded] = useState(false);

  if (!details || Object.keys(details).length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  const summary = Object.entries(details)
    .slice(0, 2)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(", ");

  if (Object.keys(details).length <= 2) {
    return <span className="text-xs text-muted-foreground">{summary}</span>;
  }

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="text-left text-xs text-muted-foreground hover:text-foreground"
    >
      {expanded ? (
        <pre className="whitespace-pre-wrap">{JSON.stringify(details, null, 2)}</pre>
      ) : (
        <span>{summary}...</span>
      )}
    </button>
  );
}

export default function AuditLogsPage() {
  const { t, formatDateTime: formatDate } = useI18n();
  const router = useRouter();
  const [filters, setFilters] = useState<AuditLogFilters>({
    page: 1,
    limit: 50,
  });

  const { data, isLoading, error: fetchError } = useAuditLogs(filters);
  const { data: users = [] } = useAdminUsers();
  const cleanup = useCleanupAuditLogs();

  // Redirect on 403
  useEffect(() => {
    if (fetchError && (fetchError as ApiError).status === 403) router.push("/");
  }, [fetchError, router]);

  const logs = data?.data || [];
  const pagination = data?.pagination;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ScrollText className="h-6 w-6 text-primary" />
              <div>
                <CardTitle>{t("backoffice.auditTitle")}</CardTitle>
                <CardDescription>{t("backoffice.auditDescription")}</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const params = new URLSearchParams();
                if (filters.category) params.set("category", filters.category);
                if (filters.userId) params.set("userId", filters.userId);
                if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
                if (filters.dateTo) params.set("dateTo", filters.dateTo);
                window.open(`/api/admin/audit-logs/export?${params}`, "_blank");
              }}
              className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              {t("backoffice.auditExport")}
            </button>
            <button
              onClick={() => {
                if (confirm(t("backoffice.auditConfirmPrune"))) {
                  cleanup.mutate();
                }
              }}
              disabled={cleanup.isPending}
              className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("backoffice.auditCleanup")}
            </button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            {/* Category tabs */}
            <div className="flex rounded-lg border overflow-hidden">
              {[
                { label: t("backoffice.auditAll"), value: "" },
                { label: t("backoffice.auditAuth"), value: "auth" },
                { label: t("backoffice.auditData"), value: "data" },
                { label: t("backoffice.auditAdmin"), value: "admin" },
              ].map((tab) => (
                <button
                  key={tab.value}
                  onClick={() =>
                    setFilters((f) => ({
                      ...f,
                      category: tab.value || undefined,
                      page: 1,
                    }))
                  }
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    (filters.category || "") === tab.value
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* User filter */}
            <select
              value={filters.userId || ""}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  userId: e.target.value || undefined,
                  page: 1,
                }))
              }
              className="rounded-lg border bg-background px-3 py-1.5 text-sm"
            >
              <option value="">{t("backoffice.auditAllUsers")}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>

            {/* Date range */}
            <input
              type="date"
              value={filters.dateFrom || ""}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  dateFrom: e.target.value || undefined,
                  page: 1,
                }))
              }
              className="rounded-lg border bg-background px-3 py-1.5 text-sm"
              placeholder={t("backoffice.auditFrom")}
            />
            <input
              type="date"
              value={filters.dateTo || ""}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  dateTo: e.target.value || undefined,
                  page: 1,
                }))
              }
              className="rounded-lg border bg-background px-3 py-1.5 text-sm"
              placeholder={t("backoffice.auditTo")}
            />
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="py-12 text-center text-muted-foreground">
              {t("backoffice.auditLoading")}
            </div>
          ) : logs.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              {t("backoffice.auditEmpty")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">{t("backoffice.auditColTime")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("backoffice.auditColUser")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("backoffice.auditColCategory")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("backoffice.auditColAction")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("backoffice.auditColTarget")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("backoffice.auditColDetails")}</th>
                    <th className="pb-2 font-medium">{t("backoffice.auditColIp")}</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log: AuditLogEntry) => (
                    <tr
                      key={log.id}
                      className="border-b last:border-0 hover:bg-muted/50"
                    >
                      <td className="py-2.5 pr-4 whitespace-nowrap text-xs text-muted-foreground">
                        {formatDate(log.createdAt)}
                      </td>
                      <td className="py-2.5 pr-4 whitespace-nowrap">
                        {log.displayName || (
                          <span className="text-muted-foreground italic">
                            {t("backoffice.auditUnknownUser")}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                            CATEGORY_COLORS[log.category] || ""
                          }`}
                        >
                          {log.category}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 whitespace-nowrap font-medium">
                        {formatAction(log.action)}
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-muted-foreground">
                        {log.targetType && log.targetId
                          ? `${log.targetType}:${log.targetId.slice(0, 8)}...`
                          : "—"}
                      </td>
                      <td className="py-2.5 pr-4 max-w-[200px]">
                        <DetailsCell details={log.details} />
                      </td>
                      <td className="py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {log.ipAddress || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-sm text-muted-foreground">
                {t("backoffice.auditPageOf", {
                  page: pagination.page,
                  total: pagination.totalPages,
                  count: pagination.total,
                })}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    setFilters((f) => ({ ...f, page: (f.page || 1) - 1 }))
                  }
                  disabled={pagination.page <= 1}
                  className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  {t("common.previous")}
                </button>
                <button
                  onClick={() =>
                    setFilters((f) => ({ ...f, page: (f.page || 1) + 1 }))
                  }
                  disabled={pagination.page >= pagination.totalPages}
                  className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
                >
                  {t("common.next")}
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
