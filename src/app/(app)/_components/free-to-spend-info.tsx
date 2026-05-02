"use client";

import { Info } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export function FreeToSpendInfo() {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="What does Free to spend mean?"
        className="text-muted-foreground hover:text-foreground transition-colors"
      >
        <Info className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-sm space-y-2">
        <p className="font-medium">Free to spend vs. Budget</p>
        <p className="text-muted-foreground">
          Free to spend is <span className="font-medium text-foreground">income left in the period</span>:
          income − reserved − fixed costs − spent.
        </p>
        <p className="text-muted-foreground">
          Budget tracks <span className="font-medium text-foreground">spent vs. allocated</span>. Going over
          budget means you spent more than you planned for those categories — you can still have free cash
          if you haven&apos;t exhausted your income.
        </p>
        <p className="text-muted-foreground">
          Free to spend only goes negative once total spending exceeds income minus reserved.
        </p>
      </PopoverContent>
    </Popover>
  );
}
