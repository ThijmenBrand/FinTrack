/**
 * The one "the plan just learned a rule" notice on screen. A module-level
 * store rather than context: the link mutation that raises it lives in a hook
 * used from popovers that close the moment they fire, so nothing near the
 * call site survives long enough to show it.
 */
export interface LearnedRule {
  planId: string;
  pattern: string;
  /** The rows the rule linked beyond the one linked by hand. */
  linkedIds: string[];
}

let current: LearnedRule | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function announceLearnedRule(rule: LearnedRule): void {
  current = rule;
  emit();
}

export function dismissLearnedRule(): void {
  current = null;
  emit();
}

export function subscribeLearnedRule(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLearnedRule(): LearnedRule | null {
  return current;
}
