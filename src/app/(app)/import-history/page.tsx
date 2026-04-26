"use client";

import { useState } from "react";
import { useImportBatches, useRollbackImport } from "@/hooks/use-import-batches";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { History, Undo2, Loader2, FileSpreadsheet } from "lucide-react";
import type { ImportBatch } from "@/types/api";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ImportHistoryPage() {
  const { data: batches = [], isLoading } = useImportBatches();
  const rollback = useRollbackImport();
  const [confirmBatch, setConfirmBatch] = useState<ImportBatch | null>(null);

  function handleRollback() {
    if (!confirmBatch) return;
    rollback.mutate(confirmBatch.id, {
      onSuccess: () => setConfirmBatch(null),
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <History className="h-6 w-6" />
          Import History
        </h1>
        <p className="text-muted-foreground mt-1">
          View all uploaded transaction files and roll back imports if needed.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Uploads</CardTitle>
          <CardDescription>
            {batches.length} import{batches.length !== 1 ? "s" : ""} total
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : batches.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileSpreadsheet className="h-12 w-12 text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground">No imports yet</p>
              <p className="text-sm text-muted-foreground/70">
                Upload a CSV file from the Transactions page to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {batches.map((batch) => (
                <div
                  key={batch.id}
                  className="group flex items-start gap-3 rounded-lg border p-4 hover:bg-muted/50 transition-colors"
                >
                  <FileSpreadsheet className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{batch.fileName}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground truncate">
                      {batch.accountName} &middot; {batch.transactionCount} transaction{batch.transactionCount !== 1 ? "s" : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground/80">
                      {formatDate(batch.importedAt)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Roll back ${batch.fileName}`}
                    className="shrink-0 -mr-2 -mt-1 h-10 w-10 p-0 sm:h-9 sm:w-auto sm:px-3 text-destructive hover:text-destructive hover:bg-destructive/10 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 sm:transition-opacity"
                    onClick={() => setConfirmBatch(batch)}
                  >
                    <Undo2 className="h-4 w-4 sm:mr-1.5" />
                    <span className="hidden sm:inline">Roll back</span>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rollback confirmation dialog */}
      <Dialog open={!!confirmBatch} onOpenChange={(open) => !open && setConfirmBatch(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Roll back import?</DialogTitle>
            <DialogDescription>
              This will permanently delete all {confirmBatch?.transactionCount} transaction{confirmBatch?.transactionCount !== 1 ? "s" : ""} from{" "}
              <span className="font-medium text-foreground">{confirmBatch?.fileName}</span>.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmBatch(null)}
              disabled={rollback.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRollback}
              disabled={rollback.isPending}
            >
              {rollback.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Rolling back...
                </>
              ) : (
                <>
                  <Undo2 className="h-4 w-4 mr-1.5" />
                  Roll back
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
