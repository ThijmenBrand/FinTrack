"use client";

import { useMemo, useState } from "react";
import { Plus, PiggyBank, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PotCard } from "@/components/pot-card";
import { PotDetailDialog } from "@/components/pot-detail-dialog";
import { CreatePotDialog } from "@/components/create-pot-dialog";
import { AllocateToPotDialog } from "@/components/allocate-to-pot-dialog";
import { usePots } from "@/hooks/use-pots";
import { useCategories } from "@/hooks/use-categories";
import { formatCurrency as fc, toIsoDate } from "@/lib/utils";
import type { Pot } from "@/types/api";

export default function PotsPage() {
  const { data: pots = [], isLoading } = usePots();
  const { data: categories = [] } = useCategories();

  const [createOpen, setCreateOpen] = useState(false);
  const [activePotId, setActivePotId] = useState<string | null>(null);
  const [quickAllocate, setQuickAllocate] = useState<Pot | null>(null);
  const [showPast, setShowPast] = useState(false);

  const { activeSpikes, pastSpikes, plain } = useMemo(() => {
    // "Past" = target date strictly more than a calendar month ago.
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setMonth(cutoff.getMonth() - 1);
    const cutoffIso = toIsoDate(cutoff);

    const activeSpikes: Pot[] = [];
    const pastSpikes: Pot[] = [];
    const plain: Pot[] = [];
    for (const p of pots) {
      if (p.targetAmount != null && p.targetDate) {
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
    return { activeSpikes, pastSpikes, plain };
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
          <h1 className="text-2xl font-bold tracking-tight">Pots</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {pots.length === 0
              ? "Group transactions or plan ahead for upcoming spikes."
              : `${pots.length} pot${pots.length === 1 ? "" : "s"}${
                  activeSpikes.length > 0
                    ? ` · ${activeSpikes.length} spike${activeSpikes.length === 1 ? "" : "s"} · ${fc(totalFunded)} saved toward ${fc(totalTarget)}`
                    : ""
                }`}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New pot
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
              <SectionHeader title="Spikes" subtitle="Planned events with a target date" />
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
              <SectionHeader title="Pots" subtitle="Groups of related transactions" />
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
                    {pastSpikes.length} past spike
                    {pastSpikes.length === 1 ? "" : "s"}
                  </span>{" "}
                  <span className="text-xs">
                    (target date more than a month ago)
                  </span>
                </span>
                <span className="flex items-center gap-1 text-xs">
                  {showPast ? "Hide" : "Show"}
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
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center rounded-lg border border-dashed">
      <PiggyBank className="h-12 w-12 text-muted-foreground/30 mb-4" />
      <h2 className="text-lg font-semibold">No pots yet</h2>
      <p className="text-sm text-muted-foreground max-w-md mt-1">
        Group related transactions into a pot, or plan ahead for an upcoming spike — like a festival or weekend trip — by setting a target amount and date.
      </p>
      <Button className="mt-4" onClick={onCreate}>
        <Plus className="h-4 w-4" />
        Create your first pot
      </Button>
    </div>
  );
}
