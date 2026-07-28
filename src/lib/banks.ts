/**
 * Known banks. The `value` is a stable slug stored in `accounts.bank` and is
 * what import behaviour keys off — never match on the display label, which is
 * free to change.
 *
 * `short`/`color` drive <BankLogo>. ponytail: brand-coloured monograms rather
 * than real logo files — no trademarked assets to vet, host or keep current.
 * Colours are close approximations; tweak here if one looks off. Swap in real
 * marks by dropping SVGs in and switching BankLogo, the call sites don't change.
 */
export const BANKS = [
  { value: "abnamro", label: "ABN AMRO", short: "ABN", color: "#009286" },
  { value: "asn", label: "ASN Bank", short: "ASN", color: "#78BE20" },
  { value: "bunq", label: "bunq", short: "b", color: "#3394D3" },
  { value: "erste", label: "Erste Bank", short: "E", color: "#0F5CA8" },
  { value: "ing", label: "ING", short: "ING", color: "#FF6200" },
  { value: "knab", label: "Knab", short: "K", color: "#E5007D" },
  { value: "n26", label: "N26", short: "N26", color: "#1A1A1A" },
  { value: "rabobank", label: "Rabobank", short: "R", color: "#000099" },
  { value: "revolut", label: "Revolut", short: "R", color: "#0666EB" },
  { value: "sns", label: "SNS Bank", short: "SNS", color: "#EE7203" },
  { value: "triodos", label: "Triodos Bank", short: "T", color: "#00A03C" },
  { value: "wise", label: "Wise", short: "W", color: "#9FE870", text: "#163300" },
  { value: "other", label: "Other" },
] as const;

export type Bank = (typeof BANKS)[number]["value"];

/** Brand mark for a stored slug, or undefined when there's nothing to draw. */
export function bankBrand(bank: string | null | undefined) {
  const found = BANKS.find((b) => b.value === bank);
  return found && "color" in found ? found : undefined;
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
