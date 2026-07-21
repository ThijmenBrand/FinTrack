"use client";

import { useState, useRef } from "react";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Upload, FileText, CheckCircle2, AlertCircle } from "lucide-react";
import { ImportReviewStep } from "@/components/import-review-step";
import type { PreviewTransaction } from "@/lib/csv-utils";
import { useCategories } from "@/hooks/use-categories";
import { usePots } from "@/hooks/use-pots";
import { usePreviewUpload, useCommitUpload } from "@/hooks/use-csv-upload";
import type { Category } from "@/types/api";

interface Account {
  id: string;
  name: string;
}

interface CsvUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: Account[];
  onUploadComplete?: () => void;
}

type UploadStep =
  | "select-file"
  | "map-columns"
  | "processing"
  | "review"
  | "committing"
  | "done";

export function CsvUploadDialog({
  open,
  onOpenChange,
  accounts,
  onUploadComplete,
}: CsvUploadDialogProps) {
  const [step, setStep] = useState<UploadStep>("select-file");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState({
    date: "",
    description: "",
    amount: "",
    name: "",
    balance: "",
    counterpartyIban: "",
  });
  const [result, setResult] = useState<{
    imported: number;
    rulesCreated: number;
    transfersDetected: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Preview + review state
  const [previewData, setPreviewData] = useState<PreviewTransaction[]>([]);
  const [previewSkipped, setPreviewSkipped] = useState(0);
  const { data: categories = [] } = useCategories();
  const { data: pots = [] } = usePots();
  const preview = usePreviewUpload();
  const commit = useCommitUpload();

  const reset = () => {
    setStep("select-file");
    setSelectedAccountId("");
    setFile(null);
    setHeaders([]);
    setPreviewRows([]);
    setMapping({ date: "", description: "", amount: "", name: "", balance: "", counterpartyIban: "" });
    setResult(null);
    setError(null);
    setPreviewData([]);
    setPreviewSkipped(0);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setError(null);

    // Detect encoding (UTF-16 LE/BE vs UTF-8) and decode to string
    const rawBytes = new Uint8Array(await f.arrayBuffer());
    let csvText: string;
    if (rawBytes[0] === 0xFF && rawBytes[1] === 0xFE) {
      csvText = new TextDecoder("utf-16le").decode(rawBytes);
    } else if (rawBytes[0] === 0xFE && rawBytes[1] === 0xFF) {
      csvText = new TextDecoder("utf-16be").decode(rawBytes);
    } else {
      csvText = new TextDecoder("utf-8").decode(rawBytes);
    }
    csvText = csvText.replace(/^\uFEFF/, "");

    Papa.parse(csvText, {
      header: true,
      preview: 6,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(),
      complete: (results) => {
        // Only fail if no data was parsed; ignore non-fatal warnings
        // (e.g. TooFewFields on trailing empty lines, TooManyFields, etc.)
        if (results.data.length === 0) {
          setError("Failed to parse CSV. Check the file format.");
          return;
        }
        const cols = (results.meta.fields || []).filter((c) => c.length > 0);
        setHeaders(cols);
        setPreviewRows(results.data as Record<string, string>[]);

        const autoMapping = { date: "", description: "", amount: "", name: "", balance: "", counterpartyIban: "" };

        const namePriority = ["partnername", "counterparty name", "naam", "name"];
        const descPriority = ["omschrijving", "description", "memo", "buchungs-details", "buchungsdetails"];
        const amountPriority = ["bedrag", "betrag", "amount", "value"];
        const balancePriority = ["saldo voor", "balance", "saldo", "kontostand"];
        const datePriority = ["buchungsdatum", "datum", "date"];
        const ibanPriority = ["tegenrekening", "iban", "counterparty", "contra", "partner iban"];

        function findBestMatch(cols: string[], keywords: string[], exclude: string[] = []): string {
          for (const kw of keywords) {
            const match = cols.find(
              (c) => c.toLowerCase().includes(kw) && !exclude.includes(c),
            );
            if (match) return match;
          }
          return "";
        }

        autoMapping.date = findBestMatch(cols, datePriority);
        autoMapping.name = findBestMatch(cols, namePriority);
        autoMapping.description = findBestMatch(cols, descPriority, [autoMapping.name]);
        autoMapping.amount = findBestMatch(cols, amountPriority);
        autoMapping.balance = findBestMatch(cols, balancePriority);
        autoMapping.counterpartyIban = findBestMatch(cols, ibanPriority);

        // If neither description nor name auto-detected, fall back to name keywords
        // for the required description field so import still proceeds.
        if (!autoMapping.description && !autoMapping.name) {
          autoMapping.description = findBestMatch(cols, namePriority);
        }
        setMapping(autoMapping);
        setStep("map-columns");
      },
    });
  };

  // Step 3: Send CSV to preview endpoint (no DB writes)
  const handlePreview = async () => {
    if (!file || !selectedAccountId) return;

    setStep("processing");
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("accountId", selectedAccountId);
      formData.append("mapping", JSON.stringify(mapping));

      const data = await preview.mutateAsync(formData);

      setPreviewData(data.transactions);
      setPreviewSkipped(data.skipped);
      setStep("review");
    } catch (err) {
      setError(String(err));
      setStep("map-columns");
    }
  };

  // Step 5: Commit reviewed transactions to the database
  const handleCommit = async (
    transactions: PreviewTransaction[],
    newRules: { pattern: string; categoryId: string; matchType: string }[]
  ) => {
    setStep("committing");
    setError(null);

    try {
      const data = await commit.mutateAsync({
        accountId: selectedAccountId,
        fileName: file?.name || "import.csv",
        transactions: transactions.map((tx) => ({
          tempId: tx.tempId,
          date: tx.date,
          name: tx.name,
          description: tx.description,
          amount: tx.amount,
          balance: tx.balance,
          type: tx.type,
          categoryId: tx.categoryId,
          groupId: tx.groupId ?? null,
          reimbursesExpenseId: tx.reimbursesExpenseId ?? null,
          notes: tx.notes ?? null,
          targetAccountId: tx.targetAccountId,
          recurringTransactionId: tx.recurringTransactionId ?? null,
        })),
        newRules,
      });

      setResult({
        imported: data.imported,
        rulesCreated: data.rulesCreated || 0,
        transfersDetected: data.transfersDetected || 0,
      });
      setStep("done");
      onUploadComplete?.();
    } catch (err) {
      console.error("CSV commit failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStep("review");
    }
  };

  const canProceedToPreview =
    mapping.date && mapping.description && mapping.amount && selectedAccountId;

  // Widen dialog for the review step
  const dialogWidth =
    step === "review" ? "sm:max-w-4xl" : "sm:max-w-2xl";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent
        className={`${dialogWidth} overflow-x-hidden transition-all`}
      >
        <DialogHeader>
          <DialogTitle>Import Bank Statement</DialogTitle>
          <DialogDescription>
            {step === "review"
              ? "Review and categorize transactions before importing."
              : "Upload a CSV file from your bank to import transactions."}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Select File */}
        {step === "select-file" && (
          <div className="space-y-4 py-4">
            <div
              className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 sm:p-12 cursor-pointer hover:border-primary/50 hover:bg-accent/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="font-medium">Click to select a CSV file</p>
              <p className="text-sm text-muted-foreground mt-1">
                Supports CSV exports from most banks
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
            {error && (
              <p className="text-sm text-destructive flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                {error}
              </p>
            )}
          </div>
        )}

        {/* Step 2: Map Columns */}
        {step === "map-columns" && (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-3 min-w-0">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium truncate">{file?.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                ({previewRows.length} rows)
              </span>
            </div>

            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Target Account</Label>
                <Select
                  value={selectedAccountId}
                  onValueChange={setSelectedAccountId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select an account..." />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>
                    Date Column <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={mapping.date}
                    onValueChange={(v) =>
                      setMapping((m) => ({ ...m, date: v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select column..." />
                    </SelectTrigger>
                    <SelectContent>
                      {headers.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>
                    Description Column <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={mapping.description}
                    onValueChange={(v) =>
                      setMapping((m) => ({ ...m, description: v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select column..." />
                    </SelectTrigger>
                    <SelectContent>
                      {headers.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>Name Column (optional)</Label>
                  <Select
                    value={mapping.name || "none"}
                    onValueChange={(v) =>
                      setMapping((m) => ({
                        ...m,
                        name: v === "none" ? "" : v,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select column..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {headers.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>
                    Amount Column <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={mapping.amount}
                    onValueChange={(v) =>
                      setMapping((m) => ({ ...m, amount: v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select column..." />
                    </SelectTrigger>
                    <SelectContent>
                      {headers.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>Balance Column (optional)</Label>
                  <Select
                    value={mapping.balance || "none"}
                    onValueChange={(v) =>
                      setMapping((m) => ({
                        ...m,
                        balance: v === "none" ? "" : v,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select column..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {headers.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Counterparty IBAN (optional)</Label>
                  <Select
                    value={mapping.counterpartyIban || "none"}
                    onValueChange={(v) =>
                      setMapping((m) => ({
                        ...m,
                        counterpartyIban: v === "none" ? "" : v,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select column..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {headers.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Preview Table */}
            {previewRows.length > 0 && (() => {
              const mobileHeaders = headers.filter(h =>
                [mapping.date, mapping.description, mapping.amount].includes(h)
              ).slice(0, 3);
              return (
                <div>
                  <Label className="mb-2 block">Data Preview</Label>
                  {/* Mobile: show only mapped columns */}
                  <div className="rounded-md border overflow-x-auto max-h-48 sm:hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {mobileHeaders.map((h) => (
                            <TableHead key={h} className="text-xs whitespace-nowrap">
                              {h}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewRows.slice(0, 3).map((row, i) => (
                          <TableRow key={i}>
                            {mobileHeaders.map((h) => (
                              <TableCell key={h} className="text-xs whitespace-nowrap max-w-[120px] truncate">
                                {row[h] || "—"}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {/* Desktop: show up to 6 columns */}
                  <div className="rounded-md border overflow-x-auto max-h-48 hidden sm:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {headers.slice(0, 6).map((h) => (
                            <TableHead key={h} className="text-xs whitespace-nowrap">
                              {h}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewRows.slice(0, 3).map((row, i) => (
                          <TableRow key={i}>
                            {headers.slice(0, 6).map((h) => (
                              <TableCell key={h} className="text-xs whitespace-nowrap">
                                {row[h] || "—"}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              );
            })()}

            {error && (
              <p className="text-sm text-destructive flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                {error}
              </p>
            )}
          </div>
        )}

        {/* Step 3: Processing (preview spinner) */}
        {step === "processing" && (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="mt-4 text-sm text-muted-foreground">
              Analyzing transactions and applying rules...
            </p>
          </div>
        )}

        {/* Step 4: Review & Categorize */}
        {step === "review" && (
          <ImportReviewStep
            transactions={previewData}
            categories={categories}
            pots={pots}
            accountId={selectedAccountId}
            skipped={previewSkipped}
            error={error}
            onBack={() => setStep("map-columns")}
            onConfirm={handleCommit}
          />
        )}

        {/* Step 5: Committing */}
        {step === "committing" && (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="mt-4 text-sm text-muted-foreground">
              Importing transactions...
            </p>
          </div>
        )}

        {/* Step 6: Done */}
        {step === "done" && result && (
          <div className="flex flex-col items-center justify-center py-12">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 dark:text-emerald-400 mb-3" />
            <p className="text-lg font-semibold">Import Complete</p>
            <p className="text-sm text-muted-foreground mt-1">
              {result.imported} transaction{result.imported !== 1 ? "s" : ""}{" "}
              imported
              {result.rulesCreated > 0 &&
                `, ${result.rulesCreated} new rule${result.rulesCreated !== 1 ? "s" : ""} created`}
            </p>
            {result.transfersDetected > 0 && (
              <p className="text-sm text-muted-foreground mt-1">
                {result.transfersDetected} internal transfer pair{result.transfersDetected !== 1 ? "s" : ""}{" "}
                detected and excluded from expenses
              </p>
            )}
          </div>
        )}

        {/* Footer — only for steps that need it (review step has its own) */}
        {step !== "review" && (
          <DialogFooter>
            {step === "map-columns" && (
              <>
                <Button variant="outline" onClick={() => reset()}>
                  Back
                </Button>
                <Button
                  onClick={handlePreview}
                  disabled={!canProceedToPreview}
                >
                  Review Transactions
                </Button>
              </>
            )}
            {step === "done" && (
              <Button
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
              >
                Done
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
