"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, RotateCcw, ServerCrash, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import { useStepUp, StepUpCancelled } from "@/hooks/use-step-up";

interface DeadJob {
  id: string;
  userId: string;
  displayName: string | null;
  type: string;
  attempts: number;
  lastErrorCode: string | null;
  lastError: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/**
 * The dead-letter queue. Metadata only: an admin sees which job failed, for
 * whom and why — never its payload or the user's bank data. Retrying or
 * discarding asks for a fresh second factor.
 */
export default function FailedJobsPage() {
  const { t, formatDateTime } = useI18n();
  const qc = useQueryClient();
  const stepUp = useStepUp();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-jobs"],
    queryFn: () => apiFetch<{ workerSeenAt: string | null; jobs: DeadJob[] }>("/api/admin/jobs"),
    refetchInterval: 30_000,
  });

  async function act(id: string, action: "replay" | "discard") {
    setBusy(id);
    setError(null);
    try {
      await stepUp.run(() =>
        apiFetch("/api/admin/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, action }),
        }),
      );
    } catch (e) {
      if (!(e instanceof StepUpCancelled)) setError(e instanceof Error ? e.message : t("common.somethingWentWrong"));
    } finally {
      setBusy(null);
      qc.invalidateQueries({ queryKey: ["admin-jobs"] });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ServerCrash className="h-5 w-5" />
          {t("backoffice.jobs.title")}
        </CardTitle>
        <CardDescription>{t("backoffice.jobs.description")}</CardDescription>
        <p className="text-xs text-muted-foreground">
          {data?.workerSeenAt
            ? t("backoffice.jobs.workerSeen", { when: formatDateTime(data.workerSeenAt) })
            : !isLoading && t("backoffice.jobs.workerNever")}
        </p>
      </CardHeader>
      <CardContent>
        {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.jobs.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("backoffice.jobs.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">{t("backoffice.jobs.type")}</th>
                  <th className="py-2 pr-3 font-medium">{t("backoffice.jobs.user")}</th>
                  <th className="py-2 pr-3 font-medium">{t("backoffice.jobs.error")}</th>
                  <th className="py-2 pr-3 font-medium">{t("backoffice.jobs.attempts")}</th>
                  <th className="py-2 pr-3 font-medium">{t("backoffice.jobs.failedAt")}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((j) => (
                  <tr key={j.id} className="border-b align-top last:border-b-0">
                    <td className="py-2 pr-3 font-mono text-xs">{j.type}</td>
                    <td className="py-2 pr-3">{j.displayName ?? j.userId}</td>
                    <td className="py-2 pr-3">
                      <span className="font-mono text-xs">{j.lastErrorCode}</span>
                      {j.lastError && <p className="text-xs text-muted-foreground">{j.lastError}</p>}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{j.attempts}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-xs">
                      {j.finishedAt ? formatDateTime(j.finishedAt) : "—"}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <Button size="sm" variant="outline" onClick={() => act(j.id, "replay")} disabled={busy === j.id}>
                        <RotateCcw />
                        {t("backoffice.jobs.replay")}
                      </Button>{" "}
                      <Button size="sm" variant="ghost" onClick={() => act(j.id, "discard")} disabled={busy === j.id}>
                        <Trash2 />
                        {t("backoffice.jobs.discard")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      {stepUp.dialog}
    </Card>
  );
}
