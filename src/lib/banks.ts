/**
 * Known banks. The `value` is a stable slug stored in `accounts.bank` and is
 * what import behaviour keys off — never match on the display label, which is
 * free to change.
 *
 * Every value except "other" has a matching mark at `public/banks/<value>.png`
 * (each bank's own app-store icon, 256px). Adding a bank means adding the file.
 */
export const BANKS = [
  { value: "abnamro", label: "ABN AMRO" },
  { value: "asn", label: "ASN Bank" },
  { value: "bunq", label: "bunq" },
  { value: "erste", label: "Erste Bank" },
  { value: "ing", label: "ING" },
  { value: "knab", label: "Knab" },
  { value: "n26", label: "N26" },
  { value: "rabobank", label: "Rabobank" },
  { value: "revolut", label: "Revolut" },
  { value: "sns", label: "SNS Bank" },
  { value: "triodos", label: "Triodos Bank" },
  { value: "wise", label: "Wise" },
  { value: "other", label: "Other" },
] as const;

export type Bank = (typeof BANKS)[number]["value"];

/**
 * Logo for a stored slug, or undefined when there's nothing to draw. Only known
 * slugs resolve, so a junk `accounts.bank` can't steer the image src.
 */
export function bankLogo(bank: string | null | undefined) {
  if (!isBank(bank) || bank === "other") return undefined;
  const { label } = BANKS.find((b) => b.value === bank)!;
  return { src: `/banks/${bank}.png`, label };
}

export function isBank(v: unknown): v is Bank {
  return typeof v === "string" && BANKS.some((b) => b.value === v);
}

/** Display label for a stored slug; falls back to the free-text bank name. */
export function bankLabel(bank: string | null, bankName: string | null): string | null {
  if (bank === "other" || bank === null) return bankName;
  return BANKS.find((b) => b.value === bank)?.label ?? bankName;
}

/**
 * Revolut exports a separate `Fee` column: the running balance moves by
 * `amount - fee`, so an ATM withdrawal of -403,45 with an 8,07 fee actually
 * takes 411,52 out of the account. Only Revolut is handled — other banks in
 * this list fold fees into the amount already, and applying this to them would
 * double-charge.
 */
export function bankHasSeparateFeeColumn(bank: string | null): boolean {
  return bank === "revolut";
}
