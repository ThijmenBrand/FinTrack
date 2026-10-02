import { cn } from "@/lib/utils";

/** A bank's initial on a quiet tile — tells the banks apart without logos. */
export function BankMark({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-muted text-sm font-semibold text-muted-foreground",
        className,
      )}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** "NL91ABNA0417164300" → "NL91 ABNA 0417 1643 00". */
export function formatIban(iban: string): string {
  return iban.replace(/\s+/g, "").replace(/(.{4})(?=.)/g, "$1 ");
}

/** Just enough of an IBAN to tell your own accounts apart: "NL91 ··· 4300". */
export function maskedIban(iban: string | null): string | null {
  if (!iban) return null;
  const compact = iban.replace(/\s+/g, "");
  return compact.length > 8 ? `${compact.slice(0, 4)} ··· ${compact.slice(-4)}` : compact;
}
