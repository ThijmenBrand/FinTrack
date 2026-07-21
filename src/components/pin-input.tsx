"use client";

import type { Ref } from "react";

interface PinInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (digits: string) => void;
  /** Unused; kept for backwards compatibility with existing call sites. */
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
  /** Trigger the error state (red field + shake) after a failed attempt. */
  invalid?: boolean;
}

const MAX_PIN = 6;

/**
 * PIN entry rendered as a single lock-screen dot field: a real (invisible)
 * input captures digits while the dots below are the visible feedback — one
 * affordance, not a text box plus a separate indicator.
 */
export function PinInput({
  id,
  label,
  value,
  onChange,
  inputRef,
  invalid = false,
}: PinInputProps) {
  return (
    <div className="space-y-2.5">
      <label
        htmlFor={id}
        className="text-sm font-medium leading-none text-foreground"
      >
        {label}
      </label>

      <div className="relative">
        <input
          id={id}
          ref={inputRef}
          type="tel"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={MAX_PIN}
          minLength={4}
          required
          value={value}
          onChange={(e) =>
            onChange(e.target.value.replace(/\D/g, "").slice(0, MAX_PIN))
          }
          autoComplete="off"
          aria-label={label}
          className="peer absolute inset-0 z-10 h-full w-full cursor-text rounded-lg text-transparent caret-transparent outline-none selection:bg-transparent"
        />
        <div
          aria-hidden
          className={`flex h-14 items-center justify-center gap-3 rounded-lg border bg-muted/40 transition-[border-color,box-shadow,background-color] duration-150 peer-focus:border-ring peer-focus:bg-background peer-focus:ring-2 peer-focus:ring-ring/30 ${
            invalid
              ? "animate-pin-shake border-destructive peer-focus:border-destructive peer-focus:ring-destructive/30"
              : "border-input"
          }`}
        >
          {Array.from({ length: MAX_PIN }).map((_, i) => {
            const filled = i < value.length;
            return (
              <span
                key={i}
                className={`h-3 w-3 rounded-full transition-all duration-150 ease-out ${
                  filled
                    ? "scale-100 bg-primary"
                    : "scale-90 border border-muted-foreground/35 bg-transparent"
                }`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
