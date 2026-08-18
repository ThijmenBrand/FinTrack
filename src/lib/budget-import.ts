import { parseAmount } from "@/lib/csv-utils";

/**
 * Canonical shape every parsing strategy produces and the import endpoint
 * accepts. A root node becomes a category + allocation; children become
 * budget_sub_lines (max depth 3 under the allocation, so 4 levels total).
 */
export interface ImportNode {
  name: string;
  /** Absolute value, sheet-native unit; null = section header (amount comes from children). */
  amount: number | null;
  /** Sign differed from the sheet's expense convention — review deselects these. */
  income?: boolean;
  children: ImportNode[];
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

export function flattenTree(nodes: ImportNode[], depth = 0): FlatImportRow[] {
  return nodes.flatMap((n) => [
    { name: n.name, amount: n.amount, depth, income: n.income ?? false },
    ...flattenTree(n.children, depth + 1),
  ]);
}

/**
 * Rebuild a tree from (edited) review rows. A row deeper than its
 * predecessor + 1 — e.g. because its parent was deselected — clamps up to the
 * nearest available ancestor.
 */
export function buildTree(
  rows: { name: string; amount: number | null; depth: number }[],
): ImportNode[] {
  const roots: ImportNode[] = [];
  const stack: ImportNode[] = [];
  for (const row of rows) {
    const depth = Math.min(Math.max(row.depth, 0), stack.length, MAX_IMPORT_DEPTH - 1);
    const node: ImportNode = { name: row.name, amount: row.amount, children: [] };
    (depth === 0 ? roots : stack[depth - 1].children).push(node);
    stack.length = depth;
    stack.push(node);
  }
  return roots;
}
