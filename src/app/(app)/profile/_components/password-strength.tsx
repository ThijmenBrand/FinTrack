"use client";

import { MIN_PASSWORD_LENGTH } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";

/**
 * Four bands, scored the way the server actually judges: anything under the
 * minimum length is rejected outright, so it reads as a requirement ("at least
 * 10 characters") rather than a grade. Above that, length carries more weight
 * than character classes, because it is what makes a password hard to guess.
 *
 * Deliberately not a cracking-time estimate — we can't check the common-password
 * list from the browser, so a confident "centuries to crack" would be a lie the
 * submit button then contradicts.
 */
export function passwordScore(password: string): 0 | 1 | 2 | 3 | 4 {
  if (password.length < MIN_PASSWORD_LENGTH) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) =>
    re.test(password),
  ).length;
  if (password.length >= 16 && classes >= 3) return 4;
  if (password.length >= 14 && classes >= 3) return 3;
  if (password.length >= 12 && classes >= 2) return 2;
  return 1;
}

const LEVELS: { label: MessageKey; bar: string; text: string }[] = [
  {
    label: "profile.password.strength.tooShort",
    bar: "bg-muted-foreground/40",
    text: "text-muted-foreground",
  },
  {
    label: "profile.password.strength.weak",
    bar: "bg-destructive",
    text: "text-destructive",
  },
  {
    label: "profile.password.strength.fair",
    bar: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
  },
  {
    label: "profile.password.strength.good",
    bar: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  {
    label: "profile.password.strength.strong",
    bar: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
  },
];

export function PasswordStrength({ password }: { password: string }) {
  const { t } = useI18n();
  if (!password) return null;

  const score = passwordScore(password);
  const level = LEVELS[score];
  // A score of 0 still paints one band, so the meter never reads as absent.
  const filled = Math.max(score, 1);

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i < filled ? level.bar : "bg-muted",
            )}
          />
        ))}
      </div>
      {/* Always mounted so the change is announced, not the appearance. */}
      <p aria-live="polite" className={cn("text-xs", level.text)}>
        {t(level.label, { min: MIN_PASSWORD_LENGTH })}
      </p>
    </div>
  );
}
