"use client";

import { Badge } from "@/components/ui/badge";
import { Split } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";

/**
 * "Split" badge — stands in for the category control on a split parent, which
 * carries no category of its own. Shared by every surface that lists
 * transactions so all of them refuse categorization the same way.
 */
export function SplitBadge({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <Badge variant="outline" className={`gap-1 ${className ?? ""}`}>
      <Split className="h-2.5 w-2.5" />
      {t("tx.split.badge")}
    </Badge>
  );
}
