"use client";

/**
 * THESIS: Settings is one continuous spec sheet, not a stack of business cards.
 *   It refuses the incumbent arrangement — five same-size cards, each led by a
 *   `bg-primary/10` icon medallion — where every preference shouted equally and
 *   nothing could be scanned.
 * OWN-WORLD: Inherits the app's shadcn/oklch-blue system. One bordered panel per
 *   *topic*, a muted header band naming it, and hairline-divided rows inside.
 *   Every row is label + consequence on the left, its control on a right-hand
 *   rail at a fixed width, so controls line up down the page. Accent is spent
 *   only on the active tab, the on-state, and primary actions.
 * STORY: You land on a tab, read down the left edge to find the thing, change it
 *   on the right edge, and see "Saved" in that panel's header. No Save button,
 *   no dirty state, no page-level commit.
 * FIRST VIEWPORT: "Settings" h1, a segmented tab rail beneath it, then the tab's
 *   own h2 + one-line purpose with any page actions on the same baseline, then
 *   the panels.
 * FORM: Ledger / spec-sheet rows — the grammar every settings surface the user
 *   already trusts (macOS, Stripe, Linear) shares. Chosen over the card grid it
 *   replaces because the ask was cohesion, and rows cohere where cards can't.
 */

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Check, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";

/**
 * Per-tab header. The settings layout owns the `<h1>`, so every tab opens at the
 * same level with the same shape: title, one line of purpose, actions right.
 */
export function SettingsHeader({
  title,
  description,
  actions,
  children,
}: {
  title: MessageKey;
  description?: MessageKey;
  /** Buttons, dialogs, or a save indicator — right-aligned on the title baseline. */
  actions?: React.ReactNode;
  /** A rich description (links, counts) in place of the plain `description`. */
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0 space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{t(title)}</h2>
        {description && (
          <p className="max-w-prose text-sm text-muted-foreground">{t(description)}</p>
        )}
        {children}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          {actions}
        </div>
      )}
    </div>
  );
}

/**
 * A topic. Rows go in as children and get hairline separators for free; omit the
 * title for a page whose `SettingsHeader` already names the topic.
 */
export function SettingsPanel({
  title,
  description,
  icon: Icon,
  action,
  loading,
  loadingRows = 2,
  footer,
  children,
}: {
  title?: MessageKey;
  description?: MessageKey;
  icon?: LucideIcon;
  /** Right side of the header band — normally a `<SaveStatus />`. */
  action?: React.ReactNode;
  loading?: boolean;
  loadingRows?: number;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <section className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
      {title && (
        <div className="flex items-start justify-between gap-4 border-b bg-muted/70 px-5 py-3.5">
          <div className="flex min-w-0 items-start gap-2.5">
            {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
            <div className="min-w-0 space-y-1">
              <h3 className="text-base font-semibold leading-tight tracking-tight">
                {t(title)}
              </h3>
              {description && (
                <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
                  {t(description)}
                </p>
              )}
            </div>
          </div>
          {action && <div className="shrink-0 pt-0.5">{action}</div>}
        </div>
      )}
      {loading ? (
        <div className="divide-y">
          {Array.from({ length: loadingRows }, (_, i) => (
            <div key={i} className="flex items-center justify-between gap-6 px-5 py-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-5 w-9 rounded-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="divide-y">{children}</div>
      )}
      {footer && (
        <div className="border-t bg-muted/40 px-5 py-3 text-xs leading-relaxed text-muted-foreground">
          {footer}
        </div>
      )}
    </section>
  );
}

/**
 * One setting. `control` sits on the shared right rail; anything richer (a
 * timeline, an inline form) goes in `children` under the label.
 */
export function SettingsRow({
  label,
  hint,
  htmlFor,
  control,
  children,
  className,
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  htmlFor?: string;
  control?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6",
        className,
      )}
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        {label && (
          <Label htmlFor={htmlFor} className="text-sm font-medium leading-snug">
            {label}
          </Label>
        )}
        {hint && (
          <p
            id={htmlFor ? `${htmlFor}-hint` : undefined}
            className="max-w-prose text-xs leading-relaxed text-muted-foreground"
          >
            {hint}
          </p>
        )}
        {children}
      </div>
      {control && (
        <div className="flex shrink-0 items-center sm:min-w-[11rem] sm:justify-end sm:pt-0.5">
          {control}
        </div>
      )}
    </div>
  );
}

/**
 * The common row: a label, its consequence, and a switch. Owns its a11y wiring.
 *
 * Unlike `SettingsRow` this never stacks — a switch is narrow enough to stay on
 * the right at any width, and every settings surface people already use keeps it
 * there. Stacking it left-aligned under the hint reads as an orphan.
 */
export function SettingsToggleRow({
  id,
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-4 sm:gap-6">
      <div className="min-w-0 flex-1 space-y-1.5">
        <Label htmlFor={id} className="text-sm font-medium leading-snug">
          {label}
        </Label>
        {hint && (
          <p
            id={`${id}-hint`}
            className="max-w-prose text-xs leading-relaxed text-muted-foreground"
          >
            {hint}
          </p>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-0.5"
      />
    </div>
  );
}

/**
 * Autosave feedback. Holds "Saved" for a beat after the write lands so a change
 * that resolves in 80ms still confirms itself.
 */
export function SaveStatus({ pending }: { pending: boolean }) {
  const { t } = useI18n();
  const [justSaved, setJustSaved] = React.useState(false);
  const wasPending = React.useRef(false);

  React.useEffect(() => {
    const was = wasPending.current;
    wasPending.current = pending;
    if (!was || pending) return;
    setJustSaved(true);
    const id = setTimeout(() => setJustSaved(false), 2000);
    return () => clearTimeout(id);
  }, [pending]);

  return (
    // Always mounted: a live region that appears with its message is announced
    // unreliably, so only the contents change.
    <span
      aria-live="polite"
      className="flex h-5 items-center gap-1.5 text-xs font-medium text-muted-foreground"
    >
      {pending ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("common.saving")}
        </>
      ) : justSaved ? (
        <>
          <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          {t("common.saved")}
        </>
      ) : null}
    </span>
  );
}
