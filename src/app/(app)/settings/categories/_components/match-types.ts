// Single source of truth for rule match-type options.
// Reconciled the two divergent SelectItem label sets ("Description contains
// pattern" vs "Contains") down to the short set below.
export const MATCH_TYPES = [
  { value: "contains", label: "Contains" },
  { value: "starts_with", label: "Starts with" },
  { value: "exact", label: "Exact match" },
] as const;

export const MATCH_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  MATCH_TYPES.map((m) => [m.value, m.label])
);
