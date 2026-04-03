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

interface Account {
  id: string;
  name: string;
}

interface CsvUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: Account[];
  onUploadComplete: () => void;
}

type UploadStep = "select-file" | "map-columns" | "preview" | "uploading" | "done";

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
    balance: "",
  });
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep("select-file");
    setSelectedAccountId("");
    setFile(null);
    setHeaders([]);
    setPreviewRows([]);
    setMapping({ date: "", description: "", amount: "", balance: "" });
    setResult(null);
    setError(null);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setError(null);

    // Parse just the header + first 5 rows for preview
    Papa.parse(f, {
      header: true,
      preview: 6,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(),
      complete: (results) => {
        if (results.errors.length > 0) {
          setError("Failed to parse CSV. Check the file format.");
          return;
        }
        const cols = results.meta.fields || [];
        setHeaders(cols);
        setPreviewRows(results.data as Record<string, string>[]);

        // Auto-detect column mapping with priority system
        // Higher priority keywords are checked first so more specific columns win
        const autoMapping = { date: "", description: "", amount: "", balance: "" };

        // Priority-ordered keyword lists (first match wins per field)
        const descPriority = ["omschrijving", "description", "memo", "naam", "name"];
        const amountPriority = ["bedrag", "amount", "value"];
        const balancePriority = ["saldo voor", "balance", "saldo"];
        const datePriority = ["datum", "date"];

        function findBestMatch(cols: string[], keywords: string[]): string {
          for (const kw of keywords) {
            const match = cols.find((c) => c.toLowerCase().includes(kw));
            if (match) return match;
          }
          return "";
        }

        autoMapping.date = findBestMatch(cols, datePriority);
        autoMapping.description = findBestMatch(cols, descPriority);
        autoMapping.amount = findBestMatch(cols, amountPriority);
        autoMapping.balance = findBestMatch(cols, balancePriority);
        setMapping(autoMapping);
        setStep("map-columns");
      },
    });
  };

  const handleUpload = async () => {
    if (!file || !selectedAccountId) return;

    setStep("uploading");
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("accountId", selectedAccountId);
      formData.append("mapping", JSON.stringify(mapping));

      const res = await fetch("/api/transactions/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Upload failed");
      }

      setResult({ imported: data.imported, skipped: data.skipped });
      setStep("done");
      onUploadComplete();
    } catch (err) {
      setError(String(err));
      setStep("preview");
    }
  };

  const canProceedToPreview = mapping.date && mapping.description && mapping.amount && selectedAccountId;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Bank Statement</DialogTitle>
          <DialogDescription>
            Upload a CSV file from your bank to import transactions.
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Select File */}
        {step === "select-file" && (
          <div className="space-y-4 py-4">
            <div
              className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 cursor-pointer hover:border-primary/50 hover:bg-accent/50 transition-colors"
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
            <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-3">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{file?.name}</span>
              <span className="text-xs text-muted-foreground">
                ({previewRows.length} rows previewed)
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

              <div className="grid grid-cols-2 gap-4">
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
              </div>
            </div>

            {/* Preview Table */}
            {previewRows.length > 0 && (
              <div>
                <Label className="mb-2 block">Data Preview</Label>
                <div className="rounded-md border overflow-x-auto max-h-48">
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
            )}

            {error && (
              <p className="text-sm text-destructive flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                {error}
              </p>
            )}
          </div>
        )}

        {/* Step 3: Uploading */}
        {step === "uploading" && (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="mt-4 text-sm text-muted-foreground">
              Importing transactions...
            </p>
          </div>
        )}

        {/* Step 4: Done */}
        {step === "done" && result && (
          <div className="flex flex-col items-center justify-center py-12">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mb-3" />
            <p className="text-lg font-semibold">Import Complete</p>
            <p className="text-sm text-muted-foreground mt-1">
              {result.imported} transaction{result.imported !== 1 ? "s" : ""}{" "}
              imported
              {result.skipped > 0 &&
                `, ${result.skipped} row${result.skipped !== 1 ? "s" : ""} skipped`}
            </p>
          </div>
        )}

        <DialogFooter>
          {step === "map-columns" && (
            <>
              <Button variant="outline" onClick={() => { reset(); }}>
                Back
              </Button>
              <Button
                onClick={() => {
                  setStep("preview");
                  handleUpload();
                }}
                disabled={!canProceedToPreview}
              >
                Import Transactions
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
      </DialogContent>
    </Dialog>
  );
}
