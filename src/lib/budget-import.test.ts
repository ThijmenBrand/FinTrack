import { describe, expect, it } from "vitest";
import {
  buildTree,
  columnLabel,
  detectMapping,
  effectiveAmount,
  extractTree,
  flattenTree,
  type ImportNode,
} from "./budget-import";

/** Modeled on the "Begroting" sheet: :: paths, negative expenses, junk right of the amount. */
const PATH_SHEET: unknown[][] = [
  ["Post", "Verwacht jaartotaal", "Verwacht maandgemiddalde", "Sleutel", "Roel"],
  ["Salaris :: Roel", 36000, 3000, "Roel", 36000],
  ["TOTAAL INKOMSTEN", 63101, 5258.4, null, 24820],
  ["Wonen :: Hypotheek :: Rente", -11284.92, -940.41, "Gelijk", -4852],
  ["Wonen :: Hypotheek :: Premie", -3936.48, -328.04, "Roel", 0],
  ["Wonen :: Schoonmaak", -840, -70, "Gelijk", -361],
  ["Giften :: Goede doelen :: WNF:: Roel", -24, -2, "Roel", 0],
  ["Giften :: Goede doelen :: WNF:: Manon", -60, -5, "Manon", -60],
  ["Verzekering :: Inboedel", -145.93, "-12,16", "Gelijk", -62],
  ["Verzekering :: Inboedel", -145.93, "-12,16", "Manon", -62],
  ["TOTAAL VASTE LASTEN", -29525, -2460, null, -9230],
];

/** Modeled on "Begroting 2020": same-level sections, subtotals, side tables. */
const SECTION_SHEET: unknown[][] = [
  [null, 2020, "Verwacht jaartotaal", "Verwacht maand-gemiddelde"],
  [null, "UITGAVEN"],
  [null, "Woning", null, null, null, "Netto maandloon", 1509],
  [null, "Waterschapsbelastingen", -93.16, -7.76],
  [null, "Hypotheek :: Aflossing", -7668, -639],
  [null, "Subtotaal woning", -7921, -660],
  [],
  [null, "Huishouding"],
  [null, "Gas en Licht", -800, -66.67],
  [null, "Totaal", -18655, -1554],
];

/** Modeled on "Begroting 2021": indented children under a name-only header. */
const INDENT_SHEET: unknown[][] = [
  [null, null, "WIJZIGINGSHISTORIE", "Datum", "Oud"],
  [null, 2021, null, "Verwacht jaartotaal", "Verwacht maand-gemiddelde"],
  [null, "Belastingdienst"],
  [null, null, "Teruggave inkomstenbelasting", 0, 0],
  [],
  [null, "Hypotheek"],
  [null, null, "Hypotheek (MUNT)", -9000, -750],
];

const node = (name: string, tree: ImportNode[]) =>
  tree.find((n) => n.name === name);

describe("detectMapping", () => {
  it("finds the header row and prefers the monthly column", () => {
    expect(detectMapping(PATH_SHEET)).toEqual({
      headerRow: 0,
      nameCol: 0,
      amountCol: 2,
      unit: "monthly",
    });
  });

  it("skips noise rows above the header and finds the name zone", () => {
    expect(detectMapping(INDENT_SHEET)).toMatchObject({
      headerRow: 1,
      nameCol: 1,
      amountCol: 4,
    });
  });

  it("falls back to first-text/first-number columns without a header", () => {
    expect(detectMapping([["Groceries", 300]])).toEqual({
      headerRow: null,
      nameCol: 0,
      amountCol: 1,
      unit: "monthly",
    });
  });
});

describe("extractTree — :: paths", () => {
  const tree = extractTree(PATH_SHEET, detectMapping(PATH_SHEET));

  it("builds the hierarchy and drops total rows", () => {
    expect(tree.map((n) => n.name)).toEqual([
      "Salaris",
      "Wonen",
      "Giften",
      "Verzekering",
    ]);
    const wonen = node("Wonen", tree)!;
    expect(wonen.children.map((c) => c.name)).toEqual(["Hypotheek", "Schoonmaak"]);
    expect(node("Hypotheek", wonen.children)!.children).toMatchObject([
      { name: "Rente", amount: 940.41 },
      { name: "Premie", amount: 328.04 },
    ]);
  });

  it("tolerates sloppy :: spacing and clamps to 4 levels", () => {
    const wnf = node("WNF", node("Goede doelen", node("Giften", tree)!.children)!.children)!;
    expect(wnf.children).toMatchObject([
      { name: "Roel", amount: 2 },
      { name: "Manon", amount: 5 },
    ]);
  });

  it("merges duplicates by summing and parses string amounts", () => {
    expect(node("Inboedel", node("Verzekering", tree)!.children)).toMatchObject({
      amount: 24.32,
    });
  });

  it("flags the minority sign as income and stores absolute values", () => {
    expect(node("Roel", node("Salaris", tree)!.children)).toMatchObject({
      amount: 3000,
      income: true,
    });
    expect(node("Schoonmaak", node("Wonen", tree)!.children)).toMatchObject({
      amount: 70,
      income: false,
    });
  });
});

describe("extractTree — sections", () => {
  it("adopts same-level rows under name-only headers, closed by subtotals", () => {
    const tree = extractTree(SECTION_SHEET, detectMapping(SECTION_SHEET));
    expect(tree.map((n) => n.name)).toEqual(["Woning", "Huishouding"]);
    expect(node("Woning", tree)!.children).toMatchObject([
      { name: "Waterschapsbelastingen", amount: 7.76 },
      { name: "Hypotheek", children: [{ name: "Aflossing", amount: 639 }] },
    ]);
    // "UITGAVEN" was a childless label, side tables sit outside the mapped zone.
    expect(node("Huishouding", tree)!.children).toMatchObject([
      { name: "Gas en Licht", amount: 66.67 },
    ]);
  });

  it("adopts indented rows and closes sections on blank rows", () => {
    const tree = extractTree(INDENT_SHEET, detectMapping(INDENT_SHEET));
    expect(tree).toMatchObject([
      { name: "Belastingdienst", children: [{ name: "Teruggave inkomstenbelasting", amount: 0 }] },
      { name: "Hypotheek", children: [{ name: "Hypotheek (MUNT)", amount: 750 }] },
    ]);
  });
});

describe("tree helpers", () => {
  const tree: ImportNode[] = [
    {
      name: "Wonen",
      amount: 100,
      children: [
        { name: "Hypotheek", amount: 940, children: [] },
        { name: "Nuts", amount: 60, children: [] },
      ],
    },
  ];

  it("effectiveAmount takes the larger of own amount and children sum", () => {
    expect(effectiveAmount(tree[0])).toBe(1000);
    expect(effectiveAmount({ name: "x", amount: 50, children: [] })).toBe(50);
  });

  it("flatten/build round-trips", () => {
    const flat = flattenTree(tree);
    expect(flat).toEqual([
      { name: "Wonen", amount: 100, depth: 0, income: false },
      { name: "Hypotheek", amount: 940, depth: 1, income: false },
      { name: "Nuts", amount: 60, depth: 1, income: false },
    ]);
    expect(buildTree(flat)).toMatchObject(tree);
  });

  it("buildTree clamps orphaned depths to the nearest ancestor", () => {
    // "Hypotheek" (depth 1) was deselected; its depth-2 child clamps to depth 1.
    expect(
      buildTree([
        { name: "Wonen", amount: null, depth: 0 },
        { name: "Rente", amount: 940, depth: 2 },
      ]),
    ).toMatchObject([
      { name: "Wonen", children: [{ name: "Rente", amount: 940 }] },
    ]);
  });

  it("columnLabel spells spreadsheet columns", () => {
    expect([0, 1, 25, 26, 27].map(columnLabel)).toEqual(["A", "B", "Z", "AA", "AB"]);
  });
});
