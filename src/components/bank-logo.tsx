import { Landmark } from "lucide-react";
import { bankBrand } from "@/lib/banks";
import { cn } from "@/lib/utils";

/**
 * Bank mark for an account. Falls back to a neutral landmark when the account
 * has no bank set, so it can be dropped in unconditionally.
 */
export function BankLogo({
  bank,
  size = 40,
  className = "",
}: {
  bank: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const brand = bankBrand(bank);
  const box = "flex shrink-0 items-center justify-center rounded-full";

  if (!brand) {
    return (
      <div
        className={cn(box, "bg-muted text-muted-foreground", className)}
        style={{ width: size, height: size }}
      >
        <Landmark style={{ width: size * 0.45, height: size * 0.45 }} />
      </div>
    );
  }

  return (
    <div
      className={cn(box, "font-bold leading-none tracking-tight", className)}
      style={{
        width: size,
        height: size,
        backgroundColor: brand.color,
        color: "text" in brand ? brand.text : "#fff",
        // Floor keeps three-letter marks (ING, SNS, N26) legible in dropdowns.
        fontSize: Math.max(size * 0.32, 9),
      }}
      title={brand.label}
    >
      {brand.short}
    </div>
  );
}
