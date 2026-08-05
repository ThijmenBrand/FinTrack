import { describe, it, expect } from "vitest";
import { layoutSankey } from "./sankey";

// Salary → Checking → { Rent, Savings }, Savings → Holiday.
const NODES = [
  { id: "in:salary", name: "Salary" },
  { id: "acct:checking", name: "Checking" },
  { id: "acct:savings", name: "Savings" },
  { id: "cat:rent", name: "Rent" },
  { id: "cat:holiday", name: "Holiday" },
];
const LINKS = [
  { source: "in:salary", target: "acct:checking", value: 3000 },
  { source: "acct:checking", target: "cat:rent", value: 1200 },
  { source: "acct:checking", target: "acct:savings", value: 800 },
  { source: "acct:savings", target: "cat:holiday", value: 500 },
];

const OPTS = { width: 600, height: 400, nodeWidth: 10, nodePad: 10 };

describe("layoutSankey", () => {
  it("places nodes in columns by longest path from a source", () => {
    const { nodes } = layoutSankey(NODES, LINKS, OPTS);
    const depth = Object.fromEntries(nodes.map((n) => [n.id, n.depth]));
    expect(depth).toEqual({
      "in:salary": 0,
      "acct:checking": 1,
      "acct:savings": 2,
      // Paid straight out of Checking, but sinks share the last column.
      "cat:rent": 3,
      "cat:holiday": 3,
    });
    const x = Object.fromEntries(nodes.map((n) => [n.id, n.x0]));
    expect(x["in:salary"]).toBe(0);
    expect(x["cat:rent"]).toBeCloseTo(OPTS.width - OPTS.nodeWidth);
    expect(x["acct:checking"]).toBeLessThan(x["acct:savings"]);
  });

  it("sizes nodes by max(inflow, outflow) and keeps them inside the canvas", () => {
    const { nodes } = layoutSankey(NODES, LINKS, OPTS);
    const salary = nodes.find((n) => n.id === "in:salary")!;
    const checking = nodes.find((n) => n.id === "acct:checking")!;
    // Checking takes in 3000 and pays out 2000 — its bar is the larger side.
    expect(checking.value).toBe(3000);
    expect(checking.y1 - checking.y0).toBeCloseTo(salary.y1 - salary.y0);
    for (const n of nodes) {
      expect(n.y0).toBeGreaterThanOrEqual(0);
      expect(n.y1).toBeLessThanOrEqual(OPTS.height + 0.001);
      expect(Number.isFinite(n.y1 - n.y0)).toBe(true);
    }
  });

  it("stacks link endpoints within their node's bar", () => {
    const { nodes, links } = layoutSankey(NODES, LINKS, OPTS);
    const checking = nodes.find((n) => n.id === "acct:checking")!;
    const outgoing = links.filter((l) => l.source === "acct:checking");
    expect(outgoing).toHaveLength(2);
    const span = outgoing.reduce((s, l) => s + l.width, 0);
    expect(span).toBeLessThanOrEqual(checking.y1 - checking.y0 + 0.001);
    for (const l of links) expect(l.path).not.toMatch(/NaN/);
  });

  it("terminates on a cycle instead of pushing columns forever", () => {
    const { nodes } = layoutSankey(
      [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      [
        { source: "a", target: "b", value: 100 },
        { source: "b", target: "a", value: 100 },
      ],
      OPTS,
    );
    expect(nodes).toHaveLength(2);
    for (const n of nodes) expect(n.depth).toBeLessThanOrEqual(8);
  });

  it("drops zero-value and dangling links", () => {
    expect(
      layoutSankey(NODES, [{ source: "in:salary", target: "acct:checking", value: 0 }], OPTS)
        .nodes,
    ).toEqual([]);
    expect(
      layoutSankey(NODES, [{ source: "in:salary", target: "nope", value: 10 }], OPTS)
        .links,
    ).toEqual([]);
  });
});
