"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronLeft, ChevronRight, FileSpreadsheet, Loader2 } from "lucide-react";
import type { WorkBook } from "xlsx";
import { useI18n } from "@/lib/i18n/client";
import { useImportBudget, type BudgetImportResult } from "@/hooks/use-budgets";
import {
  buildTree,
  columnLabel,
  detectMapping,
  effectiveAmount,
  extractTree,
  flattenTree,
  MAX_IMPORT_DEPTH,
  MAX_IMPORT_ROWS,
  type ImportNode,
  type SheetMapping,
} from "@/lib/budget-import";

interface ImportBudgetDialogProps {
  budgetId?: string;
}

/** One editable review row: a tree node, depth-first, with a keep/drop flag. */
interface ReviewRow {
  name: string;
  amount: number | null;
  depth: number;
  checked: boolean;
}

const MONTHS_PER_YEAR = 12;

export function ImportBudgetDialog({ budgetId }: ImportBudgetDialogProps) {
  const { t, plural, formatCurrency } = useI18n();
  const importBudget = useImportBudget();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [workbook, setWorkbook] = useState<WorkBook | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [matrix, setMatrix] = useState<unknown[][] | null>(null);
  const [mapping, setMapping] = useState<SheetMapping | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BudgetImportResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const closeAndReset = () => {
    setOpen(false);
    setConfirmClose(false);
    setWorkbook(null);
    setSheetName("");
    setMatrix(null);
    setMapping(null);
    setRows([]);
    setError(null);
    setResult(null);
    importBudget.reset();
  };

  const handleOpenChange = (next: boolean) => {
    if (next) return setOpen(true);
    // X, Esc, overlay click, swipe-down and Cancel all land here — one guard
    // covers them all.
    if (rows.length > 0 && !result) return setConfirmClose(true);
    closeAndReset();
  };

  const applyMapping = (m: SheetMapping, mx: unknown[][]) => {
    setMapping(m);
    const flat = flattenTree(extractTree(mx, m)).slice(0, MAX_IMPORT_ROWS);
    const next: ReviewRow[] = flat.map((r) => ({
      name: r.name,
      amount: r.amount,
      depth: r.depth,
      // Income and zero rows arrive deselected rather than dropped — the
      // user sees everything the sheet had and re-ticks what they want.
      checked: !r.income && (r.amount === null || r.amount > 0),
    }));
    // A header row with nothing checked beneath it would import as a €0
    // category — deselect those too. Backwards, so nested headers resolve
    // from the leaves up.
    for (let i = next.length - 1; i >= 0; i--) {
      const r = next[i];
      if (r.amount !== null || !r.checked) continue;
      let hasChecked = false;
      for (let j = i + 1; j < next.length && next[j].depth > r.depth; j++) {
        if (next[j].checked) {
          hasChecked = true;
          break;
        }
      }
      if (!hasChecked) r.checked = false;
    }
    setRows(next);
    setError(flat.length === 0 ? t("budgetImport.noRows") : null);
  };

  const selectSheet = async (wb: WorkBook, name: string) => {
    const XLSX = await import("xlsx");
    const sheet = wb.Sheets[name];
    const ref = sheet?.["!ref"];
    let mx: unknown[][] = [];
    if (ref) {
      // Stray formatting can blow a sheet's declared range up to a million
      // rows, and sheet_to_json materializes every one — clamp first.
      const range = XLSX.utils.decode_range(ref);
      range.e.r = Math.min(range.e.r, range.s.r + 4999);
      range.e.c = Math.min(range.e.c, range.s.c + 19);
      mx = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        range: XLSX.utils.encode_range(range),
        blankrows: true,
      });
    }
    setMatrix(mx);
    applyMapping(detectMapping(mx), mx);
  };

  const handleSheetChange = async (name: string) => {
    if (!workbook || name === sheetName) return;
    setSheetName(name);
    setParsing(true);
    try {
      await selectSheet(workbook, name);
    } catch {
      setError(t("budgetImport.parseFailed"));
    }
    setParsing(false);
  };

  const handleFile = async (file: File) => {
    setParsing(true);
    setError(null);
    try {
      // SheetJS is heavy — pulled in only when someone actually imports.
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer());
      setWorkbook(wb);
      setSheetName(wb.SheetNames[0]);
      await selectSheet(wb, wb.SheetNames[0]);
    } catch {
      setError(t("budgetImport.parseFailed"));
    }
    setParsing(false);
  };

  const updateRow = (index: number, patch: Partial<ReviewRow>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const columnCount = matrix
    ? Math.min(
        matrix.reduce((max, r) => Math.max(max, r?.length ?? 0), 0),
        20,
      )
    : 0;
  const columnOptions = Array.from({ length: columnCount }, (_, i) => {
    const header = mapping?.headerRow !== null && mapping !== null
      ? matrix?.[mapping.headerRow!]?.[i]
      : null;
    return {
      value: String(i),
      label:
        typeof header === "string" && header.trim()
          ? `${columnLabel(i)} — ${header.trim()}`
          : columnLabel(i),
    };
  });

  const checkedRows = rows.filter((r) => r.checked);
  const checkedTree = buildTree(checkedRows);
  const total = checkedTree.reduce((sum, n) => sum + effectiveAmount(n), 0);

  const handleImport = async () => {
    setError(null);
    // Storage is always monthly; a yearly sheet converts on the way out.
    const toMonthly = (nodes: ImportNode[]): ImportNode[] =>
      mapping?.unit === "yearly"
        ? nodes.map((n) => ({
            ...n,
            amount: n.amount === null ? null : n.amount / MONTHS_PER_YEAR,
            children: toMonthly(n.children),
          }))
        : nodes;
    try {
      setResult(
        await importBudget.mutateAsync({ budgetId, nodes: toMonthly(checkedTree) }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("budgetImport.parseFailed"));
    }
  };

  const mappingSelect = (
    label: string,
    value: number,
    onChange: (col: number) => void,
  ) => (
    <div className="min-w-0 flex-1 space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {columnOptions.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {/* Icon-only on a phone — see the generate button beside it. */}
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 p-0 sm:h-8 sm:w-auto sm:px-3"
          aria-label={t("budgetImport.button")}
        >
          <FileSpreadsheet className="h-3.5 w-3.5 sm:mr-1.5" />
          <span className="hidden sm:inline">{t("budgetImport.button")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("budgetImport.title")}</DialogTitle>
          <DialogDescription>{t("budgetImport.description")}</DialogDescription>
        </DialogHeader>

        {confirmClose ? (
          // A step, not a nested dialog — this has to work inside the mobile
          // drawer too. Row state lives here, so it survives "Keep editing".
          <div className="space-y-4 py-4">
            <p className="font-medium">{t("discard.title")}</p>
            <p className="text-sm text-muted-foreground">{t("discard.body")}</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmClose(false)}>
                {t("discard.keepEditing")}
              </Button>
              <Button variant="destructive" onClick={closeAndReset}>
                {t("discard.confirm")}
              </Button>
            </DialogFooter>
          </div>
        ) : result ? (
          <div className="space-y-1 py-4 text-sm">
            <p>
              {t("budgetImport.result", {
                created: result.created,
                updated: result.updated,
                categories: result.createdCategories,
              })}
            </p>
            {result.subLinesCreated + result.subLinesUpdated > 0 && (
              <p>
                {t("budgetImport.resultSubLines", {
                  created: result.subLinesCreated,
                  updated: result.subLinesUpdated,
                })}
              </p>
            )}
            {result.skipped.length > 0 && (
              <p className="text-muted-foreground">
                {t("budgetImport.skipped", {
                  names: result.skipped.map((s) => s.name).join(", "),
                })}
              </p>
            )}
          </div>
        ) : !workbook ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={parsing}
            className="flex w-full flex-col items-center gap-2 rounded-md border border-dashed px-4 py-8 text-sm text-muted-foreground hover:bg-accent/50"
          >
            {parsing ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-5 w-5" />
            )}
            {t("budgetImport.clickToSelect")}
          </button>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              {workbook.SheetNames.length > 1 && (
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label className="text-xs">{t("budgetImport.sheet")}</Label>
                  <Select value={sheetName} onValueChange={handleSheetChange}>
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {workbook.SheetNames.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {mapping && matrix && (
                <>
                  {mappingSelect(t("budgetImport.nameColumn"), mapping.nameCol, (col) =>
                    applyMapping({ ...mapping, nameCol: col }, matrix),
                  )}
                  {mappingSelect(t("budgetImport.amountColumn"), mapping.amountCol, (col) =>
                    applyMapping({ ...mapping, amountCol: col }, matrix),
                  )}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Label className="text-xs">{t("budgetImport.unit")}</Label>
                    <Select
                      value={mapping.unit}
                      onValueChange={(unit) =>
                        setMapping({ ...mapping, unit: unit as SheetMapping["unit"] })
                      }
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="monthly">{t("budgetImport.unitMonthly")}</SelectItem>
                        <SelectItem value="yearly">{t("budgetImport.unitYearly")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </div>

            {rows.length > 0 && (
              <>
                <p className="text-sm text-muted-foreground">
                  {plural(rows.length, "budgetImport.found.one", "budgetImport.found.other")}
                </p>
                <ul className="max-h-72 divide-y overflow-y-auto rounded-md border text-sm">
                  {rows.map((row, i) => (
                    <li
                      key={i}
                      className={`flex items-center gap-2 py-1 pr-2 ${row.checked ? "" : "opacity-50"}`}
                      style={{ paddingLeft: `${0.5 + row.depth}rem` }}
                    >
                      <input
                        type="checkbox"
                        checked={row.checked}
                        onChange={(e) => updateRow(i, { checked: e.target.checked })}
                      />
                      <Input
                        value={row.name}
                        onChange={(e) => updateRow(i, { name: e.target.value })}
                        className="h-7 flex-1 border-0 px-1 shadow-none focus-visible:ring-1"
                      />
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={row.amount ?? ""}
                        placeholder="—"
                        onChange={(e) =>
                          updateRow(i, {
                            amount: e.target.value === "" ? null : parseFloat(e.target.value),
                          })
                        }
                        className="h-7 w-32 text-right tabular-nums"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        title={t("budgetImport.outdent")}
                        disabled={row.depth === 0}
                        onClick={() => updateRow(i, { depth: row.depth - 1 })}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        title={t("budgetImport.indent")}
                        disabled={
                          row.depth >= MAX_IMPORT_DEPTH - 1 ||
                          i === 0 ||
                          rows[i - 1].depth < row.depth
                        }
                        onClick={() => updateRow(i, { depth: row.depth + 1 })}
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
                <p className="text-right text-sm font-medium">
                  {t(
                    mapping?.unit === "yearly"
                      ? "budgetImport.totalYearly"
                      : "budgetImport.total",
                    { amount: formatCurrency(total) },
                  )}
                </p>
              </>
            )}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />

        {error && <p className="text-sm text-destructive">{error}</p>}

        {!confirmClose && (
          <DialogFooter>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              {result ? t("common.close") : t("common.cancel")}
            </Button>
            {!result && (
              <Button
                onClick={handleImport}
                disabled={checkedRows.length === 0 || importBudget.isPending}
              >
                {importBudget.isPending && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                {t("budgetImport.import")}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
