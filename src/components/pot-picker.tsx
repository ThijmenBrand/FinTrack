"use client";

import { Button } from "@/components/ui/button";
import { Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCreatePot } from "@/hooks/use-pots";
import { useI18n } from "@/lib/i18n/client";
import { SearchCreatePicker } from "@/components/search-create-picker";

export interface PickerPot {
  id: string;
  name: string;
}

/** Searchable pot picker with create-on-the-fly, for the import review rows. */
export function PotPicker({
  pots,
  currentId,
  onSelect,
}: {
  pots: PickerPot[];
  currentId: string | null;
  onSelect: (potId: string | null) => void;
}) {
  const { t } = useI18n();
  const createPot = useCreatePot();

  const pot = pots.find((p) => p.id === currentId);
  const label = pot ? t("csvRow.inPot", { name: pot.name }) : t("csvRow.addToPot");

  return (
    <SearchCreatePicker
      items={pots}
      value={currentId}
      onSelect={onSelect}
      onClear={() => onSelect(null)}
      creating={createPot.isPending}
      onCreate={async (name) => {
        try {
          const created = await createPot.mutateAsync({ name, categoryId: null });
          return (created as { id: string }).id;
        } catch (err) {
          console.error("Failed to create pot:", err);
          return null;
        }
      }}
      labels={{
        search: "csvRow.searchPots",
        empty: "csvRow.potsEmpty",
        create: "csvRow.createPotNamed",
        clear: "tx.row.removeFromPot",
      }}
      align="end"
      trigger={
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-haspopup="listbox"
          aria-label={label}
          title={label}
        >
          <Package
            className={cn("h-3.5 w-3.5", pot ? "text-primary" : "text-muted-foreground")}
          />
        </Button>
      }
    />
  );
}
