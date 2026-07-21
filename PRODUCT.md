# Product

<!-- Inferred from the codebase (autonomous session); adjust freely. -->

## Register

product

## Users

A single household user (Dutch locale, EUR) tracking personal finances: importing bank statements, categorizing transactions, managing budgets/envelopes, recurring costs, and insights. Used in focused sessions — reviewing an import, checking free-to-spend.

## Product Purpose

FinTrack is a personal finance tracker built on Next.js + Drizzle/libsql. It turns raw bank CSV exports into categorized, linked transactions (transfers, reimbursements, recurring plans) and reconciled dashboards. Success = the user trusts every number and can review an import in minutes.

## Brand Personality

Calm, precise, trustworthy. Numbers are monospace and tabular; state colors (emerald income, red expense, amber attention) carry meaning, never decoration.

## Anti-references

- Gamified consumer fintech (confetti, mascots, streaks).
- Dashboard-widget soup — every number shown must reconcile with the others.

## Design Principles

1. Every euro reconciles — totals across views must agree; discrepancies are bugs.
2. Density over ceremony — tables and inline edits, not wizards and modals-on-modals.
3. Attention is a state — amber highlights what needs review; everything else stays quiet.
4. Familiar shadcn/ui vocabulary everywhere; same control = same look on every screen.

## Accessibility & Inclusion

No formal WCAG target declared. Keep semantic controls, visible focus rings, aria-labels on icon-only buttons, and light/dark parity (both themes are maintained throughout).
