"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/client";
import { Check, Loader2, X } from "lucide-react";
import { Row } from "./row";
import { cents, type Ctx } from "./constants";

/**
 * The name + amount editor, shared by "add a sub-line" and "edit this one" —
 * they only ever differed in what they were seeded with and what Save called.
 * Amounts are in display units; the caller converts on the way to the server.
 */
export function SubLineForm({
  ctx,
  depth,
  initialName = "",
  initialAmount,
  lockedHint,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  ctx: Ctx;
  depth: number;
  initialName?: string;
  /** Stored units; blank when adding. */
  initialAmount?: number;
  /**
   * Why this line's money isn't typeable here — it adds up from children, or
   * it belongs to a recurring plan. The field shows the figure and refuses it.
   */
  lockedHint?: string;
  pending: boolean;
  error: string | null;
  onSubmit: (name: string, displayAmount: number) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initialName);
  const [amount, setAmount] = useState(
    initialAmount === undefined ? "" : String(cents(ctx.toDisplay(initialAmount))),
  );

  const parsed = parseFloat(amount);
  const valid = !!name.trim() && (!!lockedHint || parsed > 0);

  return (
    <Row depth={depth} full>
      <div className="w-full space-y-1">
        <div className="flex items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("budgets.subLines.namePlaceholder")}
            className="h-7 flex-1 text-sm"
            autoFocus
          />
          <Input
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            readOnly={!!lockedHint}
            className={`h-7 w-24 text-sm${lockedHint ? " text-muted-foreground" : ""}`}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => valid && onSubmit(name.trim(), parsed)}
            disabled={pending || !valid}
            aria-label={t("common.save")}
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onCancel}
            aria-label={t("common.cancel")}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        {lockedHint && <p className="text-xs text-muted-foreground">{lockedHint}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </Row>
  );
}
