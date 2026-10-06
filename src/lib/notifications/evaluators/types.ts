import type { I18n } from "@/lib/i18n/translate";
import type { Draft } from "../dispatch";
import type { NotificationType } from "../registry";

export interface EvaluationContext {
  userId: string;
  now: Date;
  i18n: I18n;
  /** The user's financial-month start day (1–28). */
  startDay: number;
  /** True when the type has a channel that can reach this user. */
  wants(type: NotificationType): boolean;
}

/**
 * Something that looks at a user's data and proposes notifications. Naive by
 * design: it may propose the same thing every run — the ledger's dedupe key
 * decides what is new.
 */
export interface Evaluator {
  /** Skipped entirely when the user wants none of these. */
  types: NotificationType[];
  run(ctx: EvaluationContext): Promise<Draft[]>;
}
