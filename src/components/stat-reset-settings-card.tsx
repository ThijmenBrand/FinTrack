"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { Loader2, Milestone, Plus } from "lucide-react";
import {
  useAddStatReset,
  useDeleteStatReset,
  useStatResets,
} from "@/hooks/use-stat-resets";
import { toIsoDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

const NOTE_MAX = 500;

/** Whole months between an ISO date and today, floored at 0. */
function monthsSince(iso: string): number {
  const from = new Date(iso + "T00:00:00");
  const now = new Date();
  const months =
    (now.getFullYear() - from.getFullYear()) * 12 +
    (now.getMonth() - from.getMonth()) -
    (now.getDate() < from.getDate() ? 1 : 0);
  return Math.max(0, months);
}

export function StatResetSettingsCard() {
  const { t } = useI18n();
  const { data: resets, isLoading } = useStatResets();
  const add = useAddStatReset();
  const remove = useDeleteStatReset();

  const today = toIsoDate(new Date());
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const active = resets?.[0] ?? null;
  const earlier = resets?.slice(1) ?? [];

  const handleAdd = async () => {
    setError(null);
    if (!date) {
      setError(t("settings.statReset.errorNoDate"));
      return;
    }
    if (date > today) {
      setError(t("settings.statReset.errorFuture"));
      return;
    }
    try {
      await add.mutateAsync({ date, note: note.trim() });
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settings.statReset.errorAdd"));
    }
  };

  // Budget suggestions only average *completed* months, so a reset inside the
  // current month leaves them with nothing until the month closes.
  const noCompleteMonthYet =
    active !== null && active.date.slice(0, 7) >= today.slice(0, 7);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Milestone className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle>{t("settings.statReset.title")}</CardTitle>
            <CardDescription>{t("settings.statReset.description")}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("common.loading")}
          </div>
        ) : !active ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            {t("settings.statReset.empty")}
          </p>
        ) : (
          // A timeline of eras, newest at the top: the rail makes it obvious
          // that each reset ends the era below it.
          <ol className="relative space-y-4 border-l pl-6">
            <ResetRow
              reset={active}
              isActive
              onDelete={async () => {
                await remove.mutateAsync(active.id);
              }}
              pending={remove.isPending}
            />
            {earlier.map((r) => (
              <ResetRow
                key={r.id}
                reset={r}
                isActive={false}
                onDelete={async () => {
                  await remove.mutateAsync(r.id);
                }}
                pending={remove.isPending}
              />
            ))}
          </ol>
        )}

        {noCompleteMonthYet && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
            {t("settings.statReset.noCompleteMonth")}
          </p>
        )}

        <div className="space-y-3 border-t pt-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label
                htmlFor="stat-reset-date"
                className="text-xs font-medium text-muted-foreground"
              >
                {t("settings.statReset.countFrom")}
              </label>
              <Input
                id="stat-reset-date"
                type="date"
                max={today}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-[170px]"
              />
            </div>
            <div className="min-w-[180px] flex-1 space-y-1.5">
              <label
                htmlFor="stat-reset-note"
                className="text-xs font-medium text-muted-foreground"
              >
                {t("settings.statReset.noteLabel")}
              </label>
              <Input
                id="stat-reset-note"
                value={note}
                maxLength={NOTE_MAX}
                placeholder={t("settings.statReset.notePlaceholder")}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <Button onClick={handleAdd} disabled={add.isPending}>
              {add.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              {t("settings.statReset.add")}
            </Button>
          </div>
          {error ? (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("settings.statReset.footnote")}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ResetRow({
  reset,
  isActive,
  onDelete,
  pending,
}: {
  reset: { id: string; date: string; note: string | null };
  isActive: boolean;
  onDelete: () => Promise<void>;
  pending: boolean;
}) {
  const { t, plural, formatDate } = useI18n();
  const months = monthsSince(reset.date);
  return (
    <li className="relative">
      <span
        aria-hidden
        className={
          "absolute -left-[1.6875rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background " +
          (isActive ? "bg-primary" : "bg-muted-foreground/40")
        }
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={
            "text-sm tabular-nums " +
            (isActive ? "font-semibold" : "text-muted-foreground")
          }
        >
          {formatDate(reset.date)}
        </span>
        {isActive && (
          <Badge variant="secondary" className="font-medium">
            {t("settings.statReset.countingFromHere")}
          </Badge>
        )}
        <ConfirmDeleteButton
          onConfirm={onDelete}
          pending={pending}
          label={t("settings.statReset.removeLabel", { date: formatDate(reset.date) })}
          className="ml-auto"
        />
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {reset.note && <span>{reset.note} · </span>}
        {isActive
          ? months === 0
            ? t("settings.statReset.lessThanMonth")
            : plural(months, "settings.statReset.dataSoFar.one", "settings.statReset.dataSoFar.other")
          : t("settings.statReset.superseded")}
      </p>
    </li>
  );
}
