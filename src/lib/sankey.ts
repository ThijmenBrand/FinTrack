/**
 * Minimal horizontal Sankey layout: nodes are placed in columns by their
 * longest path from a source, sized by max(inflow, outflow), and links are
 * emitted as centre-lines meant to be *stroked* at `width` rather than filled
 * as ribbons — same visual, a fraction of the geometry.
 *
 * ponytail: no dependency (d3-sankey is ~30kB for one chart), no iterative
 * crossing minimisation — one forward barycentre pass. Swap in d3-sankey if
 * the graph ever grows past a few dozen nodes.
 */

export interface SankeyInputNode {
  id: string;
  name: string;
  color?: string | null;
}

export interface SankeyInputLink {
  source: string;
  target: string;
  value: number;
}

export interface SankeyNode extends SankeyInputNode {
  depth: number;
  value: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface SankeyLink extends SankeyInputLink {
  /** Stroke width for the centre-line path. */
  width: number;
  path: string;
}

export interface SankeyLayout {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

interface Options {
  width: number;
  height: number;
  nodeWidth?: number;
  nodePad?: number;
}

/**
 * Longest-path depth assumes a DAG — the caller nets transfer cycles away
 * before handing the graph over. This is the backstop if one ever slips
 * through: columns stop marching rightwards instead of running away.
 */
const MAX_DEPTH = 8;

export function layoutSankey(
  inputNodes: SankeyInputNode[],
  inputLinks: SankeyInputLink[],
  { width, height, nodeWidth = 14, nodePad = 14 }: Options,
): SankeyLayout {
  const byId = new Map(inputNodes.map((n) => [n.id, n]));
  const links = inputLinks.filter(
    (l) =>
      l.value > 0 &&
      l.source !== l.target &&
      byId.has(l.source) &&
      byId.has(l.target),
  );
  if (links.length === 0) return { nodes: [], links: [] };

  // Column = longest path from a source. Relaxation stops at MAX_DEPTH so a
  // cycle can't push nodes rightwards forever.
  const depth = new Map(inputNodes.map((n) => [n.id, 0]));
  for (let i = 0; i < MAX_DEPTH; i++) {
    let changed = false;
    for (const l of links) {
      const d = depth.get(l.source)! + 1;
      if (d <= MAX_DEPTH && d > depth.get(l.target)!) {
        depth.set(l.target, d);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Sinks share the final column, so spending lines up in one edge whether the
  // money reached it directly or via another account.
  const hasOutgoing = new Set(links.map((l) => l.source));
  const lastColumn = Math.max(...depth.values());
  for (const id of depth.keys())
    if (!hasOutgoing.has(id)) depth.set(id, lastColumn);

  const inflow = new Map<string, number>();
  const outflow = new Map<string, number>();
  for (const l of links) {
    inflow.set(l.target, (inflow.get(l.target) ?? 0) + l.value);
    outflow.set(l.source, (outflow.get(l.source) ?? 0) + l.value);
  }
  const valueOf = (id: string) =>
    Math.max(inflow.get(id) ?? 0, outflow.get(id) ?? 0);

  const nodes: SankeyNode[] = inputNodes
    .filter((n) => valueOf(n.id) > 0)
    .map((n) => ({
      ...n,
      depth: depth.get(n.id)!,
      value: valueOf(n.id),
      x0: 0,
      x1: 0,
      y0: 0,
      y1: 0,
    }));

  const columns = new Map<number, SankeyNode[]>();
  for (const n of nodes) {
    const list = columns.get(n.depth) ?? [];
    list.push(n);
    columns.set(n.depth, list);
  }
  const depths = [...columns.keys()].sort((a, b) => a - b);
  const maxDepth = depths[depths.length - 1];

  for (const n of nodes) {
    n.x0 = maxDepth === 0 ? 0 : (n.depth / maxDepth) * (width - nodeWidth);
    n.x1 = n.x0 + nodeWidth;
  }

  // Gaps never eat more than half the canvas, so a crowded column still gets
  // drawable node heights instead of a negative scale.
  const widestColumn = Math.max(...[...columns.values()].map((c) => c.length));
  const pad = Math.min(nodePad, (height * 0.5) / Math.max(1, widestColumn - 1));

  let k = Infinity;
  for (const list of columns.values()) {
    const sum = list.reduce((s, n) => s + n.value, 0);
    if (sum > 0) k = Math.min(k, (height - (list.length - 1) * pad) / sum);
  }
  if (!Number.isFinite(k) || k <= 0) k = 0;

  const stack = (list: SankeyNode[]) => {
    let y = 0;
    for (const n of list) {
      n.y0 = y;
      n.y1 = y + n.value * k;
      y = n.y1 + pad;
    }
  };

  const centre = (n: SankeyNode) => (n.y0 + n.y1) / 2;
  const placed = new Map<string, SankeyNode>();

  depths.forEach((d, i) => {
    const list = columns.get(d)!;
    if (i === 0) {
      list.sort((a, b) => b.value - a.value);
    } else {
      // Sit each node next to where its money came from; nodes fed only by
      // later columns fall back to size order at the bottom.
      const bary = new Map<string, number>();
      for (const n of list) {
        let w = 0;
        let acc = 0;
        for (const l of links) {
          if (l.target !== n.id) continue;
          const src = placed.get(l.source);
          if (!src) continue;
          acc += centre(src) * l.value;
          w += l.value;
        }
        bary.set(n.id, w > 0 ? acc / w : Number.POSITIVE_INFINITY);
      }
      list.sort(
        (a, b) => bary.get(a.id)! - bary.get(b.id)! || b.value - a.value,
      );
    }
    stack(list);
    for (const n of list) placed.set(n.id, n);
  });

  // Link endpoints stack on each node's edges, ordered so ribbons entering and
  // leaving a node keep their vertical order and cross as little as possible.
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const outAt = new Map<string, number>();
  const inAt = new Map<string, number>();
  for (const n of nodes) {
    outAt.set(n.id, n.y0);
    inAt.set(n.id, n.y0);
  }

  const outLinks = [...links].sort(
    (a, b) =>
      nodeById.get(a.source)!.y0 - nodeById.get(b.source)!.y0 ||
      centre(nodeById.get(a.target)!) - centre(nodeById.get(b.target)!),
  );
  const outOffset = new Map<SankeyInputLink, number>();
  for (const l of outLinks) {
    const w = l.value * k;
    const y = outAt.get(l.source)!;
    outOffset.set(l, y + w / 2);
    outAt.set(l.source, y + w);
  }

  const inLinks = [...links].sort(
    (a, b) =>
      nodeById.get(a.target)!.y0 - nodeById.get(b.target)!.y0 ||
      centre(nodeById.get(a.source)!) - centre(nodeById.get(b.source)!),
  );
  const inOffset = new Map<SankeyInputLink, number>();
  for (const l of inLinks) {
    const w = l.value * k;
    const y = inAt.get(l.target)!;
    inOffset.set(l, y + w / 2);
    inAt.set(l.target, y + w);
  }

  const out: SankeyLink[] = links.map((l) => {
    const s = nodeById.get(l.source)!;
    const t = nodeById.get(l.target)!;
    const sy = outOffset.get(l)!;
    const ty = inOffset.get(l)!;
    const xm = (s.x1 + t.x0) / 2;
    return {
      ...l,
      width: Math.max(l.value * k, 1),
      path: `M${s.x1},${sy}C${xm},${sy} ${xm},${ty} ${t.x0},${ty}`,
    };
  });

  return { nodes, links: out };
}
