"use client";

import { useId, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";

export interface PickerItem {
  id: string;
  name: string;
  /** Indent level in the list. 0 (or absent) is a top-level row. */
  depth?: number;
  /** The top-level row this one sits under. Widens the search to the parent's
   *  name, and labels the row when that parent is filtered out from above it. */
  group?: { id: string; name: string };
}

/** One activatable line in the popover: a match, the create row, or clear. */
interface Option {
  key: string;
  label: ReactNode;
  onSelect: () => void;
  selected?: boolean;
  muted?: boolean;
  disabled?: boolean;
  /** Pixels of left padding, for a row nested under another. */
  indent?: number;
}

interface SearchCreatePickerProps<T extends PickerItem> {
  items: T[];
  /** Currently selected id, if any — drives the check/highlight. */
  value: string | null;
  onSelect: (id: string) => void;
  /** Omit to drop the create-on-the-fly row. Gives the new item's id, either
   *  straight away (optimistic create) or once the request resolves. */
  onCreate?: (name: string) => string | null | Promise<string | null>;
  creating?: boolean;
  /** Omit to drop the "clear selection" row. */
  onClear?: () => void;
  /** The closed state — rendered inside the trigger. */
  trigger: ReactNode;
  labels: {
    search: MessageKey;
    empty: MessageKey;
    /** Takes a {name} var. Required for the create row to appear. */
    create?: MessageKey;
    clear?: MessageKey;
  };
  /** Swatch or icon shown before each item's name. */
  renderLeading?: (item: T) => ReactNode;
  align?: "start" | "end";
}

/**
 * Type-to-filter list with an optional create-on-the-fly row, used wherever a
 * plain `Select` would make the user scroll a list they could describe in
 * three keystrokes.
 *
 * The whole popover is one flat `Option[]` — matches, then create, then clear —
 * so arrow keys, Enter and `aria-activedescendant` need no special cases per
 * section, and the combobox keeps the keyboard behaviour a `Select` has.
 */
export function SearchCreatePicker<T extends PickerItem>({
  items,
  value,
  onSelect,
  onCreate,
  creating = false,
  onClear,
  trigger,
  labels,
  renderLeading,
  align = "start",
}: SearchCreatePickerProps<T>) {
  const { t } = useI18n();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const name = query.trim();
  const q = name.toLowerCase();
  // No truncation: the list scrolls instead, so "not in the first five" never
  // reads as "doesn't exist". A nested row also matches on the name of the
  // group it sits under, so searching a parent keeps its children in view.
  const matches = items.filter(
    (item) =>
      item.name.toLowerCase().includes(q) ||
      !!item.group?.name.toLowerCase().includes(q),
  );
  // Every row still on screen, so a nested one can tell whether the row it
  // hangs under is above it — when it isn't, it says where it came from
  // instead of hanging off nothing.
  const visibleIds = new Set(matches.map((item) => item.id));
  const canCreate =
    !!onCreate &&
    !!labels.create &&
    name.length > 0 &&
    // Only a top-level row can collide: what gets created is a top-level thing,
    // so a nested "Fuel" under Transport must not hide "Create category Fuel".
    !items.some((item) => !item.group && item.name.toLowerCase() === q);

  const close = () => {
    setOpen(false);
    setQuery("");
    setActive(0);
  };

  const handleCreate = async () => {
    if (!onCreate) return;
    // A create that hands back no id leaves the popover open with the text
    // intact, so the user can retry or pick an existing entry instead of losing
    // what they typed. An optimistic create returns its id here and closes now.
    const created = await onCreate(name);
    if (created) {
      onSelect(created);
      close();
    }
  };

  const options: Option[] = [
    ...matches.map((item) => ({
      key: item.id,
      label: (
        <>
          {renderLeading?.(item)}
          <span className="truncate">{item.name}</span>
          {/* Always announced, so a nested option never reads as a bare word;
              only shown once the row it hangs under has been filtered away. */}
          {item.group && (
            <span
              className={
                visibleIds.has(item.group.id)
                  ? "sr-only"
                  : "ml-auto shrink-0 truncate pl-2 text-xs text-muted-foreground"
              }
            >
              {item.group.name}
            </span>
          )}
        </>
      ),
      indent: item.depth ? 8 + item.depth * 14 : undefined,
      selected: item.id === value,
      onSelect: () => {
        onSelect(item.id);
        close();
      },
    })),
    ...(canCreate
      ? [
          {
            key: "__create__",
            label: (
              <>
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t(labels.create!, { name })}</span>
              </>
            ),
            disabled: creating,
            onSelect: handleCreate,
          },
        ]
      : []),
    ...(onClear && value && labels.clear
      ? [
          {
            key: "__clear__",
            label: <span className="truncate">{t(labels.clear)}</span>,
            muted: true,
            onSelect: () => {
              onClear();
              close();
            },
          },
        ]
      : []),
  ];

  const move = (delta: number) => {
    if (options.length === 0) return;
    setActive((i) => (i + delta + options.length) % options.length);
  };

  return (
    <Popover
      // modal: inside a dialog, react-remove-scroll cancels wheel events over
      // portaled content, so the list below only scrolls by dragging its bar.
      // A modal popover brings its own scroll lock and takes the wheel back.
      modal
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setQuery("");
          setActive(0);
          setOpen(true);
        } else {
          close();
        }
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) min-w-64 p-1"
        align={align}
      >
        <Input
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={options[active] ? `${listId}-${options[active].key}` : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          placeholder={t(labels.search)}
          autoFocus
          className="h-8 text-xs"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              // The popover closes itself; stop the key reaching a dialog behind it.
              e.stopPropagation();
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              move(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              move(-1);
            } else if (e.key === "Enter") {
              e.preventDefault();
              const option = options[active];
              if (option && !option.disabled) option.onSelect();
            }
          }}
        />
        <div id={listId} role="listbox" className="mt-1 max-h-64 overflow-y-auto">
          {options.map((option, i) => (
            <button
              key={option.key}
              id={`${listId}-${option.key}`}
              type="button"
              role="option"
              aria-selected={!!option.selected}
              disabled={option.disabled}
              onClick={option.onSelect}
              onMouseEnter={() => setActive(i)}
              style={option.indent ? { paddingLeft: option.indent } : undefined}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm disabled:opacity-50",
                i === active && "bg-accent",
                option.selected && "font-medium",
                option.muted && "text-muted-foreground",
              )}
            >
              {option.label}
            </button>
          ))}

          {options.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              {t(labels.empty)}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
