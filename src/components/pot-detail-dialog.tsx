"use client";

import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { usePotDetails, useDeletePot } from "@/hooks/use-pots";
import { useCategories } from "@/hooks/use-categories";
import { AllocateToPotDialog } from "@/components/allocate-to-pot-dialog";
import { EditPotDialog } from "@/components/edit-pot-dialog";
import { PotDetailContent } from "@/components/pot-detail-content";
import { PotDetailSkeleton } from "@/components/pot-detail-skeleton";

interface PotDetailDialogProps {
  potId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function PotDetailDialog({ potId, onOpenChange }: PotDetailDialogProps) {
  const open = !!potId;
  const { data, isLoading } = usePotDetails(potId);
  const { data: categories = [] } = useCategories();
  const deletePot = useDeletePot();

  const [showAllocate, setShowAllocate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const handleDelete = async () => {
    if (!potId) return;
    await deletePot.mutateAsync(potId);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col p-0">
          {isLoading || !data ? (
            <PotDetailSkeleton />
          ) : (
            <PotDetailContent
              data={data}
              onAllocate={() => setShowAllocate(true)}
              onEdit={() => setShowEdit(true)}
              onDelete={handleDelete}
              deleting={deletePot.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {data && (
        <>
          {data.spike && (
            <AllocateToPotDialog
              open={showAllocate}
              onOpenChange={setShowAllocate}
              potId={data.pot.id}
              potName={data.pot.name}
              targetAmount={data.pot.targetAmount ?? 0}
              fundedAmount={data.pot.fundedAmount}
              suggestedAmount={data.spike.suggestedAllocation}
            />
          )}
          <EditPotDialog
            open={showEdit}
            onOpenChange={setShowEdit}
            categories={categories}
            pot={data.pot}
          />
        </>
      )}
    </>
  );
}
