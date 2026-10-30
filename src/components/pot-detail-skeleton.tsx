"use client";

import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n/client";

export function PotDetailSkeleton() {
  const { t } = useI18n();
  return (
    <>
      {/* The skeletons sit beside the title, not in it: a div can't go in the
          h2/p a dialog title and description render. */}
      <DialogHeader className="sm:px-6 sm:pt-6">
        <DialogTitle className="sr-only">{t("pots.dialog.loading")}</DialogTitle>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72" />
      </DialogHeader>
      <div className="space-y-4 pt-4 sm:px-6 sm:pb-6">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-[180px] w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </>
  );
}
