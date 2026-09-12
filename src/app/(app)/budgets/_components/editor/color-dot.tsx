"use client";

import { useState } from "react";

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * The category's own colour, where it is already shown: the dot beside the
 * name, turned into the control that sets it.
 *
 * The native picker rather than a palette — the browser already has one, and
 * a colour is the one field where the OS control is better than anything a
 * form could offer. The swatch stays the view's 8px dot; the padding gives it
 * a 24px hit target and the negative margin gives the padding back, so the row
 * is identical to the read-only one down to the pixel.
 *
 * ponytail: the colour belongs to the CATEGORY, not to this plan, so it writes
 * straight through on blur rather than joining the draft — same call the
 * category settings dialog makes. Fold it into the draft if anyone reads the
 * page's "nothing is saved until Save" as covering it too.
 */
export function ColorDot({
  color,
  onColor,
  label,
}: {
  color: string | null;
  /** Rejecting puts the dot back: the colour on screen is the colour stored. */
  onColor: (hex: string) => Promise<unknown>;
  label: string;
}) {
  // The picker reports every step of a drag; only what it settles on is worth
  // a request, so the dragging lives here and the commit waits for blur.
  const current = color && HEX.test(color) ? color : "#94a3b8";
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <input
      type="color"
      aria-label={label}
      value={picked ?? current}
      onChange={(e) => setPicked(e.target.value)}
      onBlur={async () => {
        if (!picked || picked.toLowerCase() === current.toLowerCase()) return;
        // Dropping the local pick is the whole revert: without it the dot
        // keeps showing a colour the server never accepted.
        try {
          await onColor(picked);
        } catch {
          setPicked(null);
        }
      }}
      className="-m-2 h-6 w-6 shrink-0 cursor-pointer appearance-none border-0 bg-transparent p-2 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0"
    />
  );
}
