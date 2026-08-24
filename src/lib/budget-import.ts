import { parseAmount } from "@/lib/csv-utils";
import type { CategoryKind } from "@/types/api";

/**
 * Canonical shape every parsing strategy produces and the import endpoint
 * accepts. A root node becomes a category; what hangs off it depends on the
 * root's type (see RowType) — an allocation with budget_sub_lines, or one
 * recurring plan per leaf.
 */
export interface ImportNode {
  name: string;
  /** Absolute value, sheet-native unit; null = section header (amount comes from children). */
  amount: number | null;
  /** Sign differed from the sheet's expense convention — feeds type detection. */
  income?: boolean;
  /** Set in the review list, never by parsing: this leaf is a recurring plan. */
  recurring?: boolean;
  children: ImportNode[];
}

/**
 * What a root row becomes on import. Chosen per root — not per leaf — because
 * the whole subtree lands in one category and one storage shape:
 *
 *  - `variable`      category(expense) + budgets allocation + budget_sub_lines
 *  - `fixed`         category(expense) + one recurring_transactions expense per leaf
 *  - `income`        category(income)  + one recurring_transactions income per leaf
 *  - `categoryOnly`  the category alone, no allocation and no plans
 *  - `skip`          nothing; never sent to the server
 *
 * `fixed` deliberately creates no allocation: the budgets page sums fixed
 * costs and allocations into one total, so a category carrying both would
 * count twice. A `variable` root is not bound by that — its leaves may be
 * marked recurring individually (see ImportSubmitNode.recurring), and a
 * linked sub-line renders once, absorbing the plan it stands for.
 */
export type RowType = "variable" | "fixed" | "income" | "categoryOnly" | "skip";

/** Per-root submission node. Children are sub-lines or per-leaf plans. */
export interface ImportSubmitNode {
  name: string;
  /** Monthly for `variable`; the plan's own amount for `fixed`/`income`. */
  amount: number | null;
  /**
   * `variable` roots only: this leaf is also a recurring plan, linked to the
   * sub-line it creates. The cadence is the root's `frequency` — the sheet
   * knows a name and an amount, nothing more, so there is nothing per-leaf to
   * pick. A node with children takes its amount from them and so can never
   * carry this.
   */
  recurring?: boolean;
  children: ImportSubmitNode[];
}

export interface ImportSubmitRoot extends ImportSubmitNode {
  type: Exclude<RowType, "skip">;
  /** How often each plan under this root recurs. `fixed`/`income` only. */
  frequency?: "monthly" | "yearly";
}

export interface ImportPayload {
  budgetId?: string;
  /** Recurring plans need an account; the sheet has none, so the wizard asks. */
  accountId: string;
  /** startDate for every created plan — the first day of the viewed period. */
  startDate: string;
  nodes: ImportSubmitRoot[];
}

export interface SheetMapping {
  /** Row index of the detected header; data starts after it. Null = no header. */
  headerRow: number | null;
  nameCol: number;
  amountCol: number;
  unit: "monthly" | "yearly";
}

/** One row of the editable review list — the tree, depth-first. */
export interface FlatImportRow {
  name: string;
  amount: number | null;
  depth: number;
  income: boolean;
  /** Ticked in review: make this leaf a recurring plan too. `variable` only. */
  recurring?: boolean;
  /** Index of the root this row hangs under; the type control lives there. */
  rootIndex: number;
}

/** Total node cap per import — matches the server's validation. */
export const MAX_IMPORT_ROWS = 200;
/** Category + MAX_SUB_LINE_DEPTH sub-line levels. */
export const MAX_IMPORT_DEPTH = 4;

const MONTHLY_RE = /maand|month|mnd/i;
const YEARLY_RE = /jaar|year|annual/i;
const TOTAL_RE = /^(sub)?\s*tota|^total|^som\b|^sum\b/i;

/** "A", "B", … "AA" — for labeling unnamed columns in the mapping UI. */
export function columnLabel(index: number): string {
  let label = "";
  for (let i = index; i >= 0; i = Math.floor(i / 26) - 1) {
    label = String.fromCharCode(65 + (i % 26)) + label;
  }
  return label;
}

function cellNumber(cell: unknown): number | null {
  const n =
    typeof cell === "number"
      ? cell
      : typeof cell === "string" && cell.trim()
        ? parseAmount(cell)
        : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Best-effort column detection, always overridable in the UI. A header row is
 * the first row whose cells mention a month/year unit ("Verwacht
 * maandgemiddelde", "jaartotaal", …); monthly wins over yearly when both
 * exist. Without a header: first column holding strings is the name, first
 * later column holding numbers is the amount.
 */
export function detectMapping(matrix: unknown[][]): SheetMapping {
  for (let r = 0; r < Math.min(matrix.length, 12); r++) {
    const row = matrix[r] ?? [];
    let monthly = -1;
    let yearly = -1;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (typeof cell !== "string") continue;
      if (monthly === -1 && MONTHLY_RE.test(cell)) monthly = c;
      if (yearly === -1 && YEARLY_RE.test(cell)) yearly = c;
    }
    if (monthly === -1 && yearly === -1) continue;
    const amountCol = monthly !== -1 ? monthly : yearly;
    // The name zone is whatever holds text left of the amount in the data rows.
    let nameCol = 0;
    for (let c = 0; c < amountCol; c++) {
      if (
        matrix
          .slice(r + 1)
          .some((dr) => typeof dr?.[c] === "string" && (dr[c] as string).trim())
      ) {
        nameCol = c;
        break;
      }
    }
    return {
      headerRow: r,
      nameCol,
      amountCol,
      unit: monthly !== -1 ? "monthly" : "yearly",
    };
  }

  let nameCol = -1;
  let amountCol = -1;
  for (const row of matrix) {
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      if (nameCol === -1 && typeof row[c] === "string" && (row[c] as string).trim()) {
        nameCol = c;
      }
      if (amountCol === -1 && nameCol !== -1 && c > nameCol && cellNumber(row[c]) !== null) {
        amountCol = c;
      }
    }
    if (nameCol !== -1 && amountCol !== -1) break;
  }
  return {
    headerRow: null,
    nameCol: Math.max(nameCol, 0),
    amountCol: amountCol === -1 ? Math.max(nameCol, 0) + 1 : amountCol,
    unit: "monthly",
  };
}

/** An open section: a name-only row adopting the rows that follow it. */
interface Section {
  node: ImportNode;
  level: number;
  /** Same-level rows are children in some layouts, siblings in others — decided by the first row that follows. */
  childMode: "unknown" | "indented" | "same";
}

/**
 * Parse the sheet into a node tree. Two hierarchy mechanisms compose:
 *
 * 1. Path names: "Wonen :: Hypotheek :: Rente" splits into levels (tolerant
 *    of sloppy spacing like "WNF:: Roel").
 * 2. Sections: a row with a name but no amount adopts the rows after it —
 *    either the deeper-indented ones (name in a later column) or, when the
 *    next row sits at the same level, the same-level ones until a blank row,
 *    a total row, or the next section header.
 *
 * Total rows (TOTAAL/Subtotaal/…) are dropped and close their section.
 * Duplicate names in one container merge by summing. Amounts keep their sign
 * here; normalizeSigns() resolves the sheet's expense convention afterwards.
 */
export function extractTree(matrix: unknown[][], mapping: SheetMapping): ImportNode[] {
  const { nameCol, amountCol } = mapping;
  const roots: ImportNode[] = [];
  const sections: Section[] = [];

  const container = () =>
    sections.length ? sections[sections.length - 1].node.children : roots;

  for (const row of matrix.slice(mapping.headerRow !== null ? mapping.headerRow + 1 : 0)) {
    // The name is the first text cell in the name zone; its offset is the
    // indentation level.
    let nameIdx = -1;
    for (let c = nameCol; c < amountCol; c++) {
      if (typeof row?.[c] === "string" && (row[c] as string).trim()) {
        nameIdx = c;
        break;
      }
    }
    if (nameIdx === -1) {
      // Blank row (in the mapped zone): closes every open section.
      sections.length = 0;
      continue;
    }
    const level = nameIdx - nameCol;
    const rawName = (row[nameIdx] as string).trim();
    const amount = cellNumber(row[amountCol]);

    if (TOTAL_RE.test(rawName)) {
      while (sections.length && sections[sections.length - 1].level >= level) sections.pop();
      continue;
    }

    // Settle how the innermost section adopts rows, then close the sections
    // this row falls outside of.
    const top = sections[sections.length - 1];
    if (top?.childMode === "unknown") {
      top.childMode = level > top.level ? "indented" : "same";
    }
    while (sections.length) {
      const s = sections[sections.length - 1];
      const outside =
        s.childMode === "indented"
          ? level <= s.level
          : level < s.level || (level === s.level && amount === null);
      if (!outside) break;
      sections.pop();
    }

    // Walk/create the :: path inside the current container, clamped so the
    // whole thing stays within MAX_IMPORT_DEPTH.
    let parts = rawName.split("::").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    const room = MAX_IMPORT_DEPTH - sections.length;
    if (parts.length > room) {
      parts = [...parts.slice(0, room - 1), parts.slice(room - 1).join(" :: ")];
    }

    let siblings = container();
    let node: ImportNode | undefined;
    for (let i = 0; i < parts.length; i++) {
      const isLeaf = i === parts.length - 1;
      const key = parts[i].toLowerCase();
      node = siblings.find((n) => n.name.toLowerCase() === key);
      if (!node) {
        node = { name: parts[i], amount: null, children: [] };
        siblings.push(node);
      }
      if (isLeaf && amount !== null) {
        node.amount = node.amount === null ? amount : node.amount + amount;
      }
      siblings = node.children;
    }
    if (amount === null && node && sections.length < MAX_IMPORT_DEPTH - 1) {
      sections.push({ node, level, childMode: "unknown" });
    }
  }

  return normalizeSigns(prune(roots));
}

/** Drop childless section headers ("UITGAVEN") — labels, not categories. */
function prune(nodes: ImportNode[]): ImportNode[] {
  return nodes
    .map((n) => ({ ...n, children: prune(n.children) }))
    .filter((n) => n.amount !== null || n.children.length > 0);
}

/**
 * Budget sheets write expenses negative as often as positive. Take the
 * majority sign as the expense convention, store absolute values, and flag
 * the minority (income, refunds) so review can deselect it by default.
 */
function normalizeSigns(nodes: ImportNode[]): ImportNode[] {
  let negative = 0;
  let positive = 0;
  const count = (list: ImportNode[]) => {
    for (const n of list) {
      if (n.amount !== null && n.amount !== 0) {
        if (n.amount < 0) negative++;
        else positive++;
      }
      count(n.children);
    }
  };
  count(nodes);
  const expenseSign = negative > positive ? -1 : 1;
  const apply = (list: ImportNode[]): ImportNode[] =>
    list.map((n) => ({
      ...n,
      // Rounded to cents: sheet cells often carry formula dust (72.8245).
      amount: n.amount === null ? null : Math.round(Math.abs(n.amount) * 100) / 100,
      income: n.amount !== null && n.amount !== 0 && Math.sign(n.amount) !== expenseSign,
      children: apply(n.children),
    }));
  return apply(nodes);
}

/** A node's amount for allocation math: its own, or its children's if larger. */
export function effectiveAmount(node: ImportNode): number {
  const childSum = node.children.reduce((sum, c) => sum + effectiveAmount(c), 0);
  return Math.max(node.amount ?? 0, childSum);
}

export function flattenTree(nodes: ImportNode[]): FlatImportRow[] {
  const out: FlatImportRow[] = [];
  const walk = (list: ImportNode[], depth: number, rootIndex: number) => {
    for (const n of list) {
      out.push({
        name: n.name,
        amount: n.amount,
        depth,
        income: n.income ?? false,
        rootIndex,
      });
      walk(n.children, depth + 1, rootIndex);
    }
  };
  nodes.forEach((n, i) => walk([n], 0, i));
  return out;
}

// ─── Type detection ──────────────────────────────────────────────────────────
// Pre-fills the review step's type control. Every result is overridable, so
// these patterns aim at the common Dutch/English budget sheet rather than at
// completeness.

const INCOME_RE = /inkom|income|salar|loon|verdien|earning|revenue/i;
const FIXED_SECTION_RE = /vast|fixed|recurring|terugkerend|maandlast/i;
const FIXED_KEYWORD_RE =
  // Word-bounded where a bare stem would over-match: "rent" otherwise swallows
  // the Dutch "rente" (interest) and "gas" hides inside plenty of words.
  /huur|\brent\b|hypotheek|mortgage|verzekering|insurance|abonnement|subscription|energie|energy|electric|stroom|\bgas\b|water|internet|telefoon|phone|belasting|\btax\b|contributie|lidmaatschap|membership|premie/i;

export interface DetectedType {
  type: RowType;
  /**
   * False when nothing in the sheet pointed anywhere and the default was
   * taken — the review step can filter down to exactly these rows.
   */
  confident: boolean;
}

/** Every name in the subtree, root first — what the patterns get tested against. */
function subtreeNames(node: ImportNode): string[] {
  return [node.name, ...node.children.flatMap(subtreeNames)];
}

/** How many amounts in the subtree carried the sheet's minority (income) sign. */
function signTally(node: ImportNode): { income: number; expense: number } {
  const tally = { income: 0, expense: 0 };
  const walk = (n: ImportNode) => {
    if (n.amount !== null && n.amount !== 0) {
      if (n.income) tally.income++;
      else tally.expense++;
    }
    n.children.forEach(walk);
  };
  walk(node);
  return tally;
}

/**
 * Guess what a root row should become. Signals, strongest first:
 *
 *  1. a category with this name already exists — its stored kind is the
 *     user's own answer and beats anything the sheet implies;
 *  2. the root name or its tab says "inkomsten"/"income";
 *  3. the subtree's amounts mostly carry the minority sign the sheet used for
 *     income (see normalizeSigns);
 *  4. for expenses only: the root name or tab says "vaste lasten", or most
 *     leaf names look like bills (huur, verzekering, abonnement, …).
 *
 * Falling through all of them yields `variable`, marked unconfident.
 */
export function detectRootType(
  root: ImportNode,
  sheetName: string,
  storedKinds: Map<string, CategoryKind>,
): DetectedType {
  const stored = storedKinds.get(root.name.toLowerCase());
  if (stored === "income") return { type: "income", confident: true };
  // A transfer category cannot carry a budget or a plan; the server would
  // refuse it anyway, so the wizard shows it pre-skipped instead.
  if (stored === "transfer") return { type: "skip", confident: true };

  const names = subtreeNames(root);
  if (stored !== "expense") {
    if (INCOME_RE.test(root.name) || INCOME_RE.test(sheetName)) {
      return { type: "income", confident: true };
    }
    const tally = signTally(root);
    if (tally.income > tally.expense) return { type: "income", confident: true };
  }

  if (
    FIXED_SECTION_RE.test(root.name) ||
    FIXED_SECTION_RE.test(sheetName) ||
    FIXED_KEYWORD_RE.test(root.name)
  ) {
    return { type: "fixed", confident: true };
  }
  // Leaves, not the root: "Wonen" says nothing, but "Huur" + "Gas/licht"
  // under it says fixed costs.
  const leaves = names.slice(1).length ? names.slice(1) : names;
  const billish = leaves.filter((n) => FIXED_KEYWORD_RE.test(n)).length;
  // Half the subtree is enough: "Wonen" holding Hypotheek and Premie is a
  // fixed-cost block even though "Rente" and "Schoonmaak" sit beside them.
  if (billish > 0 && billish * 2 >= leaves.length) {
    return { type: "fixed", confident: true };
  }

  return { type: "variable", confident: stored === "expense" };
}

/**
 * Rebuild a tree from (edited) review rows. A row deeper than its
 * predecessor + 1 — e.g. because its parent was deselected — clamps up to the
 * nearest available ancestor.
 */
export const MONTHS_PER_YEAR = 12;

/** The wizard's per-root settings, indexed by FlatImportRow.rootIndex. */
export interface RootConfig {
  type: RowType;
  /** What the sheet's amounts mean for this root. */
  unit: "monthly" | "yearly";
}

/**
 * Turn the kept review rows into the payload the import endpoint takes.
 *
 * Rows arrive already filtered to what the user ticked, so a root whose own
 * row was unticked leaves its children behind — buildTree promotes those to
 * roots of their own, and they inherit the type of the root they came from.
 *
 * Units resolve here, not on the server: an allocation is stored monthly, so
 * a yearly `variable` root divides by twelve, while a yearly `fixed` or
 * `income` root keeps its amount and becomes a yearly plan instead.
 */
export function buildSubmitRoots(
  rows: FlatImportRow[],
  rootConfig: RootConfig[],
): ImportSubmitRoot[] {
  const groups = new Map<number, FlatImportRow[]>();
  for (const row of rows) {
    const list = groups.get(row.rootIndex) ?? [];
    list.push(row);
    groups.set(row.rootIndex, list);
  }

  const out: ImportSubmitRoot[] = [];
  for (const [rootIndex, groupRows] of groups) {
    const config = rootConfig[rootIndex];
    if (!config || config.type === "skip") continue;
    const perMonth = config.type === "variable" && config.unit === "yearly";
    // Depth guards the recurring marker: a root becomes the allocation itself
    // (there is no sub-line to link), a container takes its amount from its
    // children, and only a `variable` root has sub-lines at all. Anything else
    // the server refuses, so a marker left behind by an edited row is dropped
    // here rather than sent.
    const scale = (node: ImportNode, depth: number): ImportSubmitNode => ({
      name: node.name,
      amount:
        node.amount === null || !perMonth ? node.amount : node.amount / MONTHS_PER_YEAR,
      children: node.children.map((c) => scale(c, depth + 1)),
      ...(node.recurring &&
      depth > 0 &&
      config.type === "variable" &&
      node.children.length === 0
        ? { recurring: true }
        : {}),
    });
    for (const tree of buildTree(groupRows)) {
      out.push({
        ...scale(tree, 0),
        type: config.type,
        ...(config.type === "fixed" || config.type === "income"
          ? { frequency: config.unit }
          : {}),
      });
    }
  }
  return out;
}

export function buildTree(
  rows: { name: string; amount: number | null; depth: number; recurring?: boolean }[],
): ImportNode[] {
  const roots: ImportNode[] = [];
  const stack: ImportNode[] = [];
  for (const row of rows) {
    const depth = Math.min(Math.max(row.depth, 0), stack.length, MAX_IMPORT_DEPTH - 1);
    const node: ImportNode = {
      name: row.name,
      amount: row.amount,
      children: [],
      ...(row.recurring ? { recurring: true } : {}),
    };
    (depth === 0 ? roots : stack[depth - 1].children).push(node);
    stack.length = depth;
    stack.push(node);
  }
  return roots;
}
