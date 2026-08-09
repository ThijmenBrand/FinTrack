"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, PiggyBank, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PotCard } from "@/components/pot-card";
import { PotDetailDialog } from "@/components/pot-detail-dialog";
import { CreatePotDialog } from "@/components/create-pot-dialog";
import { AllocateToPotDialog } from "@/components/allocate-to-pot-dialog";
import { usePots } from "@/hooks/use-pots";
import { useCategories } from "@/hooks/use-categories";
import { toIsoDate } from "@/lib/utils";
import type { Pot } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";

export default function PotsPage() {
  return (
    <Suspense>
      <PotsPageInner />
    </Suspense>
  );
}

function PotsPageInner() {
  const { t, plural, formatCurrency: fc } = useI18n();
  const { data: pots = [], isLoading } = usePots();
  const { data: categories = [] } = useCategories();
  const searchParams = useSearchParams();

  const [createOpen, setCreateOpen] = useState(false);
  // Open the pot from a ?pot= link (e.g. from a transaction's pot badge).
  const [activePotId, setActivePotId] = useState<string | null>(
    () => searchParams.get("pot")
  );
  const [quickAllocate, setQuickAllocate] = useState<Pot | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const { activeSpikes, pastSpikes, plain, archived } = useMemo(() => {
    // "Past" = target date strictly more than a calendar month ago.
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setMonth(cutoff.getMonth() - 1);
    const cutoffIso = toIsoDate(cutoff);

    const activeSpikes: Pot[] = [];
    const pastSpikes: Pot[] = [];
    const plain: Pot[] = [];
    const archived: Pot[] = [];
    for (const p of pots) {
      if (p.archivedAt) {
        archived.push(p);
      } else if (p.targetAmount != null && p.targetDate) {
        if (p.targetDate < cutoffIso) pastSpikes.push(p);
        else activeSpikes.push(p);
      } else {
        plain.push(p);
      }
    }
    activeSpikes.sort((a, b) =>
      (a.targetDate ?? "").localeCompare(b.targetDate ?? "")
    );
    // Past spikes: most recent first.
    pastSpikes.sort((a, b) =>
      (b.targetDate ?? "").localeCompare(a.targetDate ?? "")
    );
    plain.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    archived.sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
    return { activeSpikes, pastSpikes, plain, archived };
  }, [pots]);

  const totalFunded = activeSpikes.reduce((s, p) => s + p.fundedAmount, 0);
  const totalTarget = activeSpikes.reduce(
    (s, p) => s + (p.targetAmount ?? 0),
    0
  );

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("pots.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {pots.length === 0
              ? t("pots.emptySubtitle")
              : `${plural(pots.length, "pots.count.one", "pots.count.other")}${
                  activeSpikes.length > 0
                    ? ` ${plural(
                        activeSpikes.length,
                        "pots.spikeSummary.one",
                        "pots.spikeSummary.other",
                        { saved: fc(totalFunded), target: fc(totalTarget) },
                      )}`
                    : ""
                }`}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          {t("pots.new")}
        </Button>
      </header>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : pots.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="space-y-8">
          {activeSpikes.length > 0 && (
            <section className="space-y-3">
              <SectionHeader
                title={t("pots.sectionSpikes")}
                subtitle={t("pots.sectionSpikesSub")}
              />
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {activeSpikes.map((pot) => (
                  <PotCard
                    key={pot.id}
                    pot={pot}
                    onClick={() => setActivePotId(pot.id)}
                    onAllocate={() => setQuickAllocate(pot)}
                  />
                ))}
              </div>
            </section>
          )}

          {plain.length > 0 && (
            <section className="space-y-3">
              <SectionHeader
                title={t("pots.sectionPots")}
                subtitle={t("pots.sectionPotsSub")}
              />
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {plain.map((pot) => (
                  <PotCard
                    key={pot.id}
                    pot={pot}
                    onClick={() => setActivePotId(pot.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {pastSpikes.length > 0 && (
            <section className="space-y-3 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowPast((v) => !v)}
                className="w-full flex items-center justify-between gap-3 px-1 py-2 text-left text-sm text-muted-foreground hover:text-foreground transition-colors group"
                aria-expanded={showPast}
              >
                <span>
                  <span className="font-medium text-foreground">
                    {plural(pastSpikes.length, "pots.pastSpikes.one", "pots.pastSpikes.other")}
                  </span>{" "}
                  <span className="text-xs">{t("pots.pastSpikesHint")}</span>
                </span>
                <span className="flex items-center gap-1 text-xs">
                  {showPast ? t("pots.hide") : t("pots.show")}
                  {showPast ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </span>
              </button>
              {showPast && (
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 opacity-90">
                  {pastSpikes.map((pot) => (
                    <PotCard
                      key={pot.id}
                      pot={pot}
                      onClick={() => setActivePotId(pot.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {archived.length > 0 && (
            <section className="space-y-3 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className="w-full flex items-center justify-between gap-3 px-1 py-2 text-left text-sm text-muted-foreground hover:text-foreground transition-colors group"
                aria-expanded={showArchived}
              >
                <span className="font-medium text-foreground">
                  {plural(archived.length, "pots.archived.one", "pots.archived.other")}
                </span>
                <span className="flex items-center gap-1 text-xs">
                  {showArchived ? t("pots.hide") : t("pots.show")}
                  {showArchived ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </span>
              </button>
              {showArchived && (
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 opacity-75">
                  {archived.map((pot) => (
                    <PotCard
                      key={pot.id}
                      pot={pot}
                      onClick={() => setActivePotId(pot.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      <CreatePotDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        categories={categories}
      />

      <PotDetailDialog
        potId={activePotId}
        onOpenChange={(open) => {
          if (!open) setActivePotId(null);
        }}
      />

      {quickAllocate && quickAllocate.targetAmount != null && (
        <AllocateToPotDialog
          open={!!quickAllocate}
          onOpenChange={(open) => {
            if (!open) setQuickAllocate(null);
          }}
          potId={quickAllocate.id}
          potName={quickAllocate.name}
          targetAmount={quickAllocate.targetAmount}
          fundedAmount={quickAllocate.fundedAmount}
          suggestedAmount={Math.max(
            0,
            (quickAllocate.targetAmount - quickAllocate.fundedAmount)
          )}
        />
      )}
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center rounded-lg border border-dashed">
      <PiggyBank className="h-12 w-12 text-muted-foreground/30 mb-4" />
      <h2 className="text-lg font-semibold">{t("pots.emptyTitle")}</h2>
      <p className="text-sm text-muted-foreground max-w-md mt-1">{t("pots.emptyBody")}</p>
      <Button className="mt-4" onClick={onCreate}>
        <Plus className="h-4 w-4" />
        {t("pots.createFirst")}
      </Button>
    </div>
  );
}
