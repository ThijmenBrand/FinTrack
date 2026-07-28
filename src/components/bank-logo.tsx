import Image from "next/image";
import { Landmark } from "lucide-react";
import { bankLogo } from "@/lib/banks";
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
  const logo = bankLogo(bank);
  const box = "flex shrink-0 items-center justify-center overflow-hidden rounded-full";

  if (!logo) {
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
      // ponytail: ring instead of a plain crop — several marks (ABN AMRO,
      // Rabobank) sit on white, which would vanish against a light card.
      className={cn(box, "bg-white ring-1 ring-black/10", className)}
      style={{ width: size, height: size }}
    >
      <Image src={logo.src} alt={logo.label} width={size} height={size} />
    </div>
  );
}
