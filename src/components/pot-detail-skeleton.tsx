import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

export function PotDetailSkeleton() {
  return (
    <>
      <DialogHeader className="px-6 pt-6">
        <DialogTitle>
          <Skeleton className="h-6 w-48" />
        </DialogTitle>
        <DialogDescription>
          <Skeleton className="h-4 w-72" />
        </DialogDescription>
      </DialogHeader>
      <div className="px-6 pb-6 space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-[220px] w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </>
  );
}
