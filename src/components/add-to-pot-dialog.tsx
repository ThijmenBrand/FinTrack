"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { PickerDialog } from "@/components/picker-dialog";
import { PickerRow } from "@/components/picker-row";
import { useI18n } from "@/lib/i18n/client";

interface Pot {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  netAmount: number;
  transactionCount: number;
}

interface AddToPotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pots: Pot[];
  transactionDescription: string;
  onSelect: (potId: string) => Promise<void>;
  /** Create a new pot with the given name and return its id. Enables the "Create" row. */
  onCreate?: (name: string) => Promise<string>;
}

export function AddToPotDialog({
  open,
  onOpenChange,
  pots,
  transactionDescription,
  onSelect,
  onCreate,
}: AddToPotDialogProps) {
  const { t, plural, formatCurrency } = useI18n();
  const [search, setSearch] = useState("");
  const [addingId, setAddingId] = useState<string | null>(null);

  const query = search.trim();
  const filtered = search
    ? pots.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : pots;

  const canCreate =
    !!onCreate &&
    query.length > 0 &&
    !pots.some((p) => p.name.toLowerCase() === query.toLowerCase());

  const handleSelect = async (potId: string) => {
    setAddingId(potId);
    try {
      await onSelect(potId);
      onOpenChange(false);
    } finally {
      setAddingId(null);
    }
  };

  const handleCreate = async () => {
    if (!onCreate || !query) return;
    setAddingId("__create__");
    try {
      const potId = await onCreate(query);
      await onSelect(potId);
      onOpenChange(false);
    } finally {
      setAddingId(null);
    }
  };

  return (
    <PickerDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setSearch("");
        onOpenChange(o);
      }}
      title={t("pots.picker.addToPotTitle")}
      description={t("pots.picker.choosePot", { description: transactionDescription })}
      truncateDescription
      contentClassName="sm:max-w-sm"
      listClassName="max-h-[300px]"
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder={t("pots.picker.searchPots")}
      isEmpty={filtered.length === 0 && !canCreate}
      emptyMessage={t("pots.picker.noMatchingPots")}
    >
      {canCreate && (
        <PickerRow
          className="py-2.5 hover:bg-muted/50"
          onClick={handleCreate}
          disabled={addingId !== null}
          loading={addingId === "__create__"}
          leading={
            <span className="h-3 w-3 shrink-0 mr-3 flex items-center justify-center">
              <Plus className="h-4 w-4 text-muted-foreground" />
            </span>
          }
        >
          <p className="text-sm font-medium truncate">
            {t("pots.picker.createNamed", { name: query })}
          </p>
          <p className="text-xs text-muted-foreground">{t("pots.picker.newPot")}</p>
        </PickerRow>
      )}
      {filtered.map((pot) => (
        <PickerRow
          key={pot.id}
          className="py-2.5 hover:bg-muted/50"
          onClick={() => handleSelect(pot.id)}
          disabled={addingId !== null}
          loading={addingId === pot.id}
          leading={
            pot.categoryColor ? (
              <span
                className="h-3 w-3 rounded-full shrink-0 mr-3"
                style={{ backgroundColor: pot.categoryColor }}
              />
            ) : (
              <div className="w-3 mr-3 shrink-0" />
            )
          }
          trailing={
            <span
              className={`text-sm font-mono font-medium shrink-0 ml-3 ${
                pot.netAmount >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {pot.netAmount >= 0 ? "+" : ""}
              {formatCurrency(pot.netAmount)}
            </span>
          }
        >
          <p className="text-sm font-medium truncate">{pot.name}</p>
          <p className="text-xs text-muted-foreground">
            {plural(pot.transactionCount, "common.transactions.one", "common.transactions.other")}
            {pot.categoryName ? ` · ${pot.categoryName}` : ""}
          </p>
        </PickerRow>
      ))}
    </PickerDialog>
  );
}
