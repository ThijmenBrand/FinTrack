"use client";

import type { Ref } from "react";

interface PinInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (digits: string) => void;
  placeholder: string;
  inputRef?: Ref<HTMLInputElement>;
}

/** PIN text field (masked, digits-only) with the 6-dot fill indicator. */
export function PinInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  inputRef,
}: PinInputProps) {
  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className="text-sm font-medium leading-none text-foreground"
      >
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        type="tel"
        pattern="[0-9]*"
        maxLength={6}
        required
        minLength={4}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        autoComplete="off"
        className="flex h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-lg tracking-[0.5em] text-center text-transparent caret-transparent selection:bg-transparent ring-offset-background placeholder:text-muted-foreground placeholder:tracking-normal placeholder:text-sm placeholder:text-opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        placeholder={placeholder}
      />
      <div className="flex justify-center gap-2 pt-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={`h-2.5 w-2.5 rounded-full transition-colors ${
              i < value.length ? "bg-primary" : "bg-muted"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
