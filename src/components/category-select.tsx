"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategoryIcon } from "@/components/category-icon";
import type { Category } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";

export const NO_CATEGORY_VALUE = "__none__";

interface CategorySelectProps {
  value: string;
  onValueChange: (value: string) => void;
  categories: Category[];
  placeholder?: string;
  className?: string;
  allowNone?: boolean;
  noneLabel?: string;
}

export function CategorySelect({
  value,
  onValueChange,
  categories,
  placeholder,
  className = "h-8 text-sm",
  allowNone = false,
  noneLabel,
}: CategorySelectProps) {
  const { t } = useI18n();
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder ?? t("categorySelect.placeholder")} />
      </SelectTrigger>
      <SelectContent>
        {allowNone && (
          <SelectItem value={NO_CATEGORY_VALUE}>
            <span className="text-muted-foreground">{noneLabel ?? t("categorySelect.none")}</span>
          </SelectItem>
        )}
        {categories.map((cat) => (
          <SelectItem key={cat.id} value={cat.id}>
            <span className="flex items-center gap-2">
              <CategoryIcon icon={cat.icon} color={cat.color} size="sm" />
              {cat.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
