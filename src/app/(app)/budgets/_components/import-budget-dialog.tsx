"use client";

import { useMemo, useRef, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronLeft, ChevronRight, FileSpreadsheet, Loader2, Repeat } from "lucide-react";
import type { WorkBook } from "xlsx";
import { useI18n } from "@/lib/i18n/client";
import { MAX_USERNAME_LENGTH } from "@/lib/validation";
import { useImportBudget, type BudgetImportResult } from "@/hooks/use-budgets";
import { useCategories } from "@/hooks/use-categories";
import type { Account, CategoryKind } from "@/types/api";
import {
  buildSubmitRoots,
  columnLabel,
  detectMapping,
  detectRootType,
  effectiveAmount,
  extractTree,
  flattenTree,
  MAX_IMPORT_DEPTH,
  MAX_IMPORT_ROWS,
  type FlatImportRow,
  type ImportPayload,
  type RootConfig,
  type RowType,
  type SheetMapping,
} from "@/lib/budget-import";

interface ImportBudgetDialogProps {
  budgetId?: string;
  /** Accounts the user can attach recurring plans to. */
  accounts: Account[];
  /** Pre-selected account; the budget plan's first account. */
  defaultAccountId?: string;
  /** First day of the viewed budget period, YYYY-MM-DD — every plan's startDate. */
  startDate: string;
}

/** A review row: a flattened tree node plus its keep/drop flag. */
interface ReviewRow extends FlatImportRow {
  checked: boolean;
}

/** A worksheet the user ticked, parsed once and remapped in place. */
interface ParsedSheet {
  matrix: unknown[][];
  mapping: SheetMapping;
}

const TYPE_OPTIONS: RowType[] = ["variable", "fixed", "income", "categoryOnly", "skip"];

/** Same cap the import endpoint enforces via `validateName`. */
const isNameTooLong = (name: string) => name.trim().length > MAX_USERNAME_LENGTH;

export function ImportBudgetDialog({
  budgetId,
  accounts,
  defaultAccountId,
  startDate,
}: ImportBudgetDialogProps) {
  const { t, plural, formatCurrency } = useI18n();
  const importBudget = useImportBudget();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [workbook, setWorkbook] = useState<WorkBook | null>(null);
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);
  const [sheets, setSheets] = useState<Record<string, ParsedSheet>>({});
  const [accountId, setAccountId] = useState(defaultAccountId ?? accounts[0]?.id ?? "");
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [rootConfigs, setRootConfigs] = useState<RootConfig[]>([]);
  /** Per root: did detection actually find a signal? Drives the filter. */
  const [confident, setConfident] = useState<boolean[]>([]);
  const [uncertainOnly, setUncertainOnly] = useState(false);
  /** Any manual edit in step 3 — going back would silently discard it. */
  const [touched, setTouched] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BudgetImportResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmBack, setConfirmBack] = useState(false);

  // Categories of the account's owner: an existing category's kind is the
  // user's own answer, so it seeds detection and flags conflicts.
  const { data: categories } = useCategories(accountId || undefined);
  const storedKinds = useMemo(
    () =>
      new Map<string, CategoryKind>(
        (categories ?? []).map((c) => [c.name.toLowerCase(), c.kind]),
      ),
    [categories],
  );

  const closeAndReset = () => {
    setOpen(false);
    setStep(1);
    setConfirmClose(false);
    setConfirmBack(false);
    setWorkbook(null);
    setSelectedSheets([]);
    setSheets({});
    setRows([]);
    setRootConfigs([]);
    setConfident([]);
    setUncertainOnly(false);
    setTouched(false);
    setError(null);
    setResult(null);
    importBudget.reset();
  };

  const handleOpenChange = (next: boolean) => {
    if (next) return setOpen(true);
    // X, Esc, overlay click, swipe-down and Cancel all land here — one guard
    // covers them all.
    if (workbook && !result) return setConfirmClose(true);
    closeAndReset();
  };

  /** Read one worksheet into a matrix + detected mapping. */
  const parseSheet = async (wb: WorkBook, name: string): Promise<ParsedSheet> => {
    const XLSX = await import("xlsx");
    const sheet = wb.Sheets[name];
    const ref = sheet?.["!ref"];
    let matrix: unknown[][] = [];
    if (ref) {
      // Stray formatting can blow a sheet's declared range up to a million
      // rows, and sheet_to_json materializes every one — clamp first.
      const range = XLSX.utils.decode_range(ref);
      range.e.r = Math.min(range.e.r, range.s.r + 4999);
      range.e.c = Math.min(range.e.c, range.s.c + 19);
      matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        range: XLSX.utils.encode_range(range),
        blankrows: true,
      });
    }
    return { matrix, mapping: detectMapping(matrix) };
  };

  const handleFile = async (file: File) => {
    setParsing(true);
    setError(null);
    try {
      // SheetJS is heavy — pulled in only when someone actually imports.
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer());
      const first = wb.SheetNames[0];
      setWorkbook(wb);
      setSelectedSheets([first]);
      setSheets({ [first]: await parseSheet(wb, first) });
      setStep(2);
    } catch {
      setError(t("budgetImport.parseFailed"));
    }
    setParsing(false);
  };

  const toggleSheet = async (name: string, on: boolean) => {
    if (!on) {
      setSelectedSheets((prev) => prev.filter((n) => n !== name));
      return;
    }
    // Keep workbook order so the review list reads like the file does.
    setSelectedSheets((prev) =>
      [...prev, name].sort(
        (a, b) => workbook!.SheetNames.indexOf(a) - workbook!.SheetNames.indexOf(b),
      ),
    );
    if (sheets[name] || !workbook) return;
    setParsing(true);
    try {
      const parsed = await parseSheet(workbook, name);
      setSheets((prev) => ({ ...prev, [name]: parsed }));
    } catch {
      setError(t("budgetImport.parseFailed"));
    }
    setParsing(false);
  };

  const setSheetMapping = (name: string, patch: Partial<SheetMapping>) => {
    setSheets((prev) => ({ ...prev, [name]: { ...prev[name], mapping: { ...prev[name].mapping, ...patch } } }));
  };

  /**
   * Step 2 → 3: parse every selected sheet into one flat list. Root indices
   * are offset per sheet so a root keeps its own type across the whole list.
   */
  const buildReview = () => {
    const nextRows: ReviewRow[] = [];
    const configs: RootConfig[] = [];
    const confidences: boolean[] = [];

    for (const name of selectedSheets) {
      const sheet = sheets[name];
      if (!sheet) continue;
      const trees = extractTree(sheet.matrix, sheet.mapping);
      const offset = configs.length;
      for (const root of trees) {
        const detected = detectRootType(root, name, storedKinds);
        configs.push({ type: detected.type, unit: sheet.mapping.unit });
        confidences.push(detected.confident);
      }
      for (const row of flattenTree(trees)) {
        const rootIndex = row.rootIndex + offset;
        nextRows.push({
          ...row,
          rootIndex,
          // Zero rows and anything under a skipped root arrive unticked — the
          // user sees everything the sheet had and re-ticks what they want.
          checked: configs[rootIndex].type !== "skip" && row.amount !== 0,
        });
      }
    }

    // A header row with nothing checked beneath it would import as a €0
    // category — untick those too. Backwards, so nested headers resolve from
    // the leaves up.
    for (let i = nextRows.length - 1; i >= 0; i--) {
      const row = nextRows[i];
      if (row.amount !== null || !row.checked) continue;
      let hasChecked = false;
      for (let j = i + 1; j < nextRows.length && nextRows[j].depth > row.depth; j++) {
        if (nextRows[j].checked) {
          hasChecked = true;
          break;
        }
      }
      if (!hasChecked) row.checked = false;
    }

    setRows(nextRows);
    setRootConfigs(configs);
    setConfident(confidences);
    setTouched(false);
    setError(nextRows.length === 0 ? t("budgetImport.noRows") : null);
    setStep(3);
  };

  const updateRow = (index: number, patch: Partial<ReviewRow>) => {
    setTouched(true);
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const updateRoot = (rootIndex: number, patch: Partial<RootConfig>) => {
    setTouched(true);
    setRootConfigs((prev) => prev.map((c, i) => (i === rootIndex ? { ...c, ...patch } : c)));
  };

  const setAllTypes = (type: RowType) => {
    setTouched(true);
    setRootConfigs((prev) => prev.map((c) => ({ ...c, type })));
  };

  /**
   * The stored kind wins on the server, so a mismatch is worth a warning but
   * never a block — the row still imports, just not as the user typed it.
   */
  const kindConflict = (row: ReviewRow) => {
    if (row.depth !== 0) return false;
    const stored = storedKinds.get(row.name.trim().toLowerCase());
    const type = rootConfigs[row.rootIndex]?.type;
    if (stored === "expense") return type === "income" || type === "categoryOnly";
    if (stored === "income") return type === "variable" || type === "fixed";
    return false;
  };

  // What actually gets sent: ticked rows under a root that isn't skipped.
  const keptIndices = rows.reduce<number[]>((acc, r, i) => {
    if (r.checked && rootConfigs[r.rootIndex]?.type !== "skip") acc.push(i);
    return acc;
  }, []);
  const keptRows = keptIndices.map((i) => rows[i]);
  const submitRoots = buildSubmitRoots(keptRows, rootConfigs);
  // Money going out only: netting income against expenses here would read as a
  // budget total while being neither.
  const total = submitRoots
    .filter((r) => r.type === "variable" || r.type === "fixed")
    .reduce((sum, n) => sum + effectiveAmount(n), 0);

  /** View-only narrowing to the roots detection was unsure about. */
  const isVisible = (row: ReviewRow) => !uncertainOnly || confident[row.rootIndex] === false;

  /**
   * Where a per-line plan makes sense: a leaf under a `variable` root. Only
   * those become sub-lines a plan can link to — a root becomes the allocation
   * itself, a row with children takes its amount from them, and `fixed` and
   * `income` roots already turn every leaf into a plan.
   */
  const canRecur = (row: ReviewRow, index: number) =>
    row.depth > 0 &&
    rootConfigs[row.rootIndex]?.type === "variable" &&
    (index + 1 >= rows.length || rows[index + 1].depth <= row.depth);

  const scrollToRow = (index: number) => {
    // The row may be hidden behind the filter; the filter is only a view, so
    // dropping it is free.
    setUncertainOnly(false);
    requestAnimationFrame(() =>
      listRef.current
        ?.querySelector(`[data-row="${index}"]`)
        ?.scrollIntoView({ block: "center" }),
    );
  };

  const handleImport = async () => {
    setError(null);
    // The API rejects the whole payload on the first over-long name — catch it
    // here so the offending row can be pointed at instead of a footer error.
    // Only rows actually being sent — a long name under a skipped root is the
    // user's business, not a reason to block the import.
    const firstTooLong = keptIndices.find((i) => isNameTooLong(rows[i].name));
    if (firstTooLong !== undefined) {
      setError(t("budgetImport.namesTooLong", { max: MAX_USERNAME_LENGTH }));
      scrollToRow(firstTooLong);
      return;
    }
    if (keptRows.length > MAX_IMPORT_ROWS) {
      setError(t("budgetImport.tooManyRows", { max: MAX_IMPORT_ROWS }));
      return;
    }
    const payload: ImportPayload = {
      budgetId,
      accountId,
      startDate,
      nodes: submitRoots,
    };
    try {
      setResult(await importBudget.mutateAsync(payload));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("budgetImport.parseFailed"));
    }
  };

  const columnOptions = (sheet: ParsedSheet) => {
    const count = Math.min(
      sheet.matrix.reduce((max, r) => Math.max(max, r?.length ?? 0), 0),
      20,
    );
    return Array.from({ length: count }, (_, i) => {
      const header =
        sheet.mapping.headerRow !== null ? sheet.matrix[sheet.mapping.headerRow]?.[i] : null;
      return {
        value: String(i),
        label:
          typeof header === "string" && header.trim()
            ? `${columnLabel(i)} — ${header.trim()}`
            : columnLabel(i),
      };
    });
  };

  const unitSelect = (
    id: string,
    value: RootConfig["unit"],
    onChange: (unit: RootConfig["unit"]) => void,
  ) => (
    <Select value={value} onValueChange={(v) => onChange(v as RootConfig["unit"])}>
      <SelectTrigger id={id} className="h-8">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="monthly">{t("budgetImport.unitMonthly")}</SelectItem>
        <SelectItem value="yearly">{t("budgetImport.unitYearly")}</SelectItem>
      </SelectContent>
    </Select>
  );

  const stepTitle =
    step === 1
      ? t("budgetImport.step.upload")
      : step === 2
        ? t("budgetImport.step.mapping")
        : t("budgetImport.step.review");

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
          <DialogDescription>
            {result ? t("budgetImport.description") : stepTitle}
          </DialogDescription>
        </DialogHeader>

        {confirmClose || confirmBack ? (
          // A step, not a nested dialog — this has to work inside the mobile
          // drawer too. Wizard state lives here, so it survives "Keep editing".
          <div className="space-y-4 py-4">
            <p className="font-medium">{t("discard.title")}</p>
            <p className="text-sm text-muted-foreground">
              {confirmBack ? t("budgetImport.mappingChanged") : t("discard.body")}
            </p>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => (confirmBack ? setConfirmBack(false) : setConfirmClose(false))}
              >
                {t("discard.keepEditing")}
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (!confirmBack) return closeAndReset();
                  setConfirmBack(false);
                  setStep(2);
                }}
              >
                {t("discard.confirm")}
              </Button>
            </DialogFooter>
          </div>
        ) : result ? (
          <div className="space-y-1 py-4 text-sm">
            <p>
              {t("budgetImport.result", {
                created: result.created,
                categories: result.createdCategories,
              })}
            </p>
            {result.subLinesCreated > 0 && (
              <p>{t("budgetImport.resultSubLines", { created: result.subLinesCreated })}</p>
            )}
            {result.incomePlansCreated + result.fixedPlansCreated > 0 && (
              <p>
                {t("budgetImport.resultPlans", {
                  income: result.incomePlansCreated,
                  fixed: result.fixedPlansCreated,
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
        ) : step === 1 ? (
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
        ) : step === 2 ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("budgetImport.sheets")}</Label>
              <p className="text-xs text-muted-foreground">{t("budgetImport.sheetsHint")}</p>
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                {workbook?.SheetNames.map((name) => (
                  <li key={name} className="flex items-center gap-2">
                    <Checkbox
                      id={`sheet-${name}`}
                      checked={selectedSheets.includes(name)}
                      onCheckedChange={(v) => toggleSheet(name, v === true)}
                    />
                    <Label htmlFor={`sheet-${name}`} className="text-sm font-normal">
                      {name}
                    </Label>
                  </li>
                ))}
              </ul>
            </div>

            {selectedSheets.map((name) => {
              const sheet = sheets[name];
              if (!sheet) return null;
              const options = columnOptions(sheet);
              return (
                <div key={name} className="space-y-1.5 rounded-md border p-2">
                  <p className="text-xs font-medium">{name}</p>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Label htmlFor={`name-${name}`} className="text-xs">
                        {t("budgetImport.nameColumn")}
                      </Label>
                      <Select
                        value={String(sheet.mapping.nameCol)}
                        onValueChange={(v) => setSheetMapping(name, { nameCol: Number(v) })}
                      >
                        <SelectTrigger id={`name-${name}`} className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Label htmlFor={`amount-${name}`} className="text-xs">
                        {t("budgetImport.amountColumn")}
                      </Label>
                      <Select
                        value={String(sheet.mapping.amountCol)}
                        onValueChange={(v) => setSheetMapping(name, { amountCol: Number(v) })}
                      >
                        <SelectTrigger id={`amount-${name}`} className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Label htmlFor={`unit-${name}`} className="text-xs">
                        {t("budgetImport.unit")}
                      </Label>
                      {unitSelect(`unit-${name}`, sheet.mapping.unit, (unit) =>
                        setSheetMapping(name, { unit }),
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="space-y-1.5">
              <Label htmlFor="import-account" className="text-xs">
                {t("budgetImport.account")}
              </Label>
              {accounts.length === 0 ? (
                <p className="text-sm text-destructive">{t("budgetImport.noAccounts")}</p>
              ) : (
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger id="import-account" className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {plural(rows.length, "budgetImport.found.one", "budgetImport.found.other")}
              </p>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="uncertain-only"
                  checked={uncertainOnly}
                  onCheckedChange={(v) => setUncertainOnly(v === true)}
                />
                <Label htmlFor="uncertain-only" className="text-xs font-normal">
                  {t("budgetImport.uncertainOnly")}
                </Label>
                <Select onValueChange={(v) => setAllTypes(v as RowType)}>
                  <SelectTrigger className="h-8 w-40" aria-label={t("budgetImport.setAll")}>
                    <SelectValue placeholder={t("budgetImport.setAll")} />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPE_OPTIONS.map((type) => (
                      <SelectItem key={type} value={type}>
                        {t(`budgetImport.type.${type}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("budgetImport.typeHint")}</p>

            <ul
              ref={listRef}
              className="max-h-72 divide-y overflow-y-auto rounded-md border text-sm"
            >
              {rows.map((row, i) => {
                if (!isVisible(row)) return null;
                const tooLong = isNameTooLong(row.name);
                const config = rootConfigs[row.rootIndex];
                const conflict = kindConflict(row);
                return (
                  <li
                    key={i}
                    data-row={i}
                    className={`py-1 pr-2 ${row.checked ? "" : "opacity-50"} ${tooLong ? "bg-destructive/10" : ""}`}
                    style={{ paddingLeft: `${0.5 + row.depth}rem` }}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={row.checked}
                        aria-label={row.name}
                        onChange={(e) => updateRow(i, { checked: e.target.checked })}
                      />
                      <Input
                        value={row.name}
                        onChange={(e) => updateRow(i, { name: e.target.value })}
                        aria-invalid={tooLong || undefined}
                        aria-describedby={
                          tooLong || conflict ? `row-msg-${i}` : undefined
                        }
                        className={`h-7 flex-1 px-1 shadow-none focus-visible:ring-1 ${
                          tooLong ? "border border-destructive text-destructive" : "border-0"
                        }`}
                      />
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={row.amount ?? ""}
                        placeholder="—"
                        aria-label={t("budgetImport.amountColumn")}
                        onChange={(e) =>
                          updateRow(i, {
                            amount: e.target.value === "" ? null : parseFloat(e.target.value),
                          })
                        }
                        className="h-7 w-28 text-right tabular-nums"
                      />
                      {canRecur(row, i) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`h-6 w-6 p-0 ${
                            row.recurring ? "text-primary" : "text-muted-foreground"
                          }`}
                          title={t("budgets.import.leafRecurring")}
                          aria-label={`${t("budgets.import.leafRecurring")} — ${row.name}`}
                          aria-pressed={!!row.recurring}
                          onClick={() => updateRow(i, { recurring: !row.recurring })}
                        >
                          <Repeat className="h-3.5 w-3.5" />
                        </Button>
                      )}
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
                    </div>

                    {/* Type and unit are per root: the whole subtree lands in
                        one category and one storage shape. */}
                    {row.depth === 0 && config && (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Select
                          value={config.type}
                          onValueChange={(v) => updateRoot(row.rootIndex, { type: v as RowType })}
                        >
                          <SelectTrigger
                            className="h-8 w-40"
                            aria-label={`${t("budgetImport.type")} — ${row.name}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TYPE_OPTIONS.map((type) => (
                              <SelectItem key={type} value={type}>
                                {t(`budgetImport.type.${type}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {config.type !== "categoryOnly" && config.type !== "skip" && (
                          <div className="w-36">
                            {unitSelect(`root-unit-${row.rootIndex}`, config.unit, (unit) =>
                              updateRoot(row.rootIndex, { unit }),
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {(tooLong || conflict) && (
                      <p id={`row-msg-${i}`} className="mt-1 text-xs text-destructive">
                        {tooLong
                          ? t("budgetImport.namesTooLong", { max: MAX_USERNAME_LENGTH })
                          : t("budgetImport.kindConflict")}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-right text-sm font-medium">
              {t("budgetImport.total", { amount: formatCurrency(total) })}
            </p>
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

        {!confirmClose && !confirmBack && (
          <DialogFooter>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              {result ? t("common.close") : t("common.cancel")}
            </Button>
            {!result && step > 1 && (
              <Button
                variant="outline"
                onClick={() => {
                  if (step === 2) return setStep(1);
                  if (touched) return setConfirmBack(true);
                  setStep(2);
                }}
              >
                {t("budgetImport.back")}
              </Button>
            )}
            {!result && step === 2 && (
              <Button
                onClick={buildReview}
                disabled={selectedSheets.length === 0 || !accountId || parsing}
              >
                {t("budgetImport.next")}
              </Button>
            )}
            {!result && step === 3 && (
              <Button
                onClick={handleImport}
                disabled={keptRows.length === 0 || importBudget.isPending}
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
