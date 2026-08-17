import type { MessageKey } from "@/lib/i18n/translate";

// Single source of truth for rule match-type options.
export const MATCH_TYPES: { value: string; labelKey: MessageKey }[] = [
  { value: "contains", labelKey: "categories.match.contains" },
  { value: "starts_with", labelKey: "categories.match.startsWith" },
  { value: "exact", labelKey: "categories.match.exact" },
];

export const MATCH_TYPE_LABEL_KEYS: Record<string, MessageKey> = Object.fromEntries(
  MATCH_TYPES.map((m) => [m.value, m.labelKey]),
);

// Which transaction text the pattern is compared against.
export const MATCH_FIELDS: { value: string; labelKey: MessageKey }[] = [
  { value: "both", labelKey: "categories.matchField.both" },
  { value: "name", labelKey: "categories.matchField.name" },
  { value: "description", labelKey: "categories.matchField.description" },
];

export const MATCH_FIELD_LABEL_KEYS: Record<string, MessageKey> = Object.fromEntries(
  MATCH_FIELDS.map((f) => [f.value, f.labelKey]),
);
