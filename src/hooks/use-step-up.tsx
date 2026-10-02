"use client";

import { useCallback, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { StepUpDialog } from "@/components/step-up-dialog";

/** Thrown out of `run` when the user closes the "Confirm it's you" dialog. */
export class StepUpCancelled extends Error {
  constructor() {
    super("Step-up cancelled");
    this.name = "StepUpCancelled";
  }
}

/**
 * Run a sensitive request; if the server answers `step_up_required`, ask the
 * user to confirm with a second factor and retry once. Render `dialog`
 * somewhere in the component.
 *
 *   const stepUp = useStepUp();
 *   await stepUp.run(() => apiFetch("/api/…", { method: "DELETE" }));
 */
export function useStepUp() {
  const [open, setOpen] = useState(false);
  // A new key per prompt: the dialog starts clean every time it opens.
  const [prompt, setPrompt] = useState(0);
  const pending = useRef<{ resolve: () => void; reject: (e: Error) => void } | null>(null);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "step_up_required")) throw err;
      await new Promise<void>((resolve, reject) => {
        pending.current = { resolve, reject };
        setPrompt((n) => n + 1);
        setOpen(true);
      });
      return fn();
    }
  }, []);

  const settle = (ok: boolean) => {
    const p = pending.current;
    pending.current = null;
    setOpen(false);
    if (ok) p?.resolve();
    else p?.reject(new StepUpCancelled());
  };

  const dialog = (
    <StepUpDialog key={prompt} open={open} onConfirmed={() => settle(true)} onCancel={() => settle(false)} />
  );

  return { run, dialog };
}
