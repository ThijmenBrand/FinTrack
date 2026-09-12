import { describe, it, expect } from "vitest";
import { flattenSubLines } from "@/lib/budget-sub-lines";

const line = (id: string, parentId: string | null, name = id, categoryId = "cat-a") => ({
  id,
  parentId,
  name,
  categoryId,
});

describe("flattenSubLines", () => {
  it("puts every line straight after the one it hangs under, with its depth", () => {
    // Deliberately not in tree order: the rows arrive in creation order, and a
    // child can be older than a sibling of its parent.
    const flat = flattenSubLines([
      line("fuel", "car"),
      line("car", null),
      line("train", null),
      line("diesel", "fuel"),
    ]);

    expect(flat.map((l) => [l.id, l.depth])).toEqual([
      ["car", 1],
      ["fuel", 2],
      ["diesel", 3],
      ["train", 1],
    ]);
  });

  it("keeps each category's lines to itself", () => {
    const flat = flattenSubLines([
      line("gas", null, "Gas", "transport"),
      line("veg", null, "Veg", "groceries"),
    ]);

    expect(flat.map((l) => [l.id, l.categoryId])).toEqual([
      ["gas", "transport"],
      ["veg", "groceries"],
    ]);
  });

  it("drops a line whose parent chain is unreachable instead of hanging", () => {
    // A parentId pointing at nothing shouldn't be possible; a cycle even less
    // so. Both cost the row its place in the list and nothing else.
    const flat = flattenSubLines([
      line("real", null),
      line("orphan", "gone"),
      line("a", "b"),
      line("b", "a"),
    ]);

    expect(flat.map((l) => l.id)).toEqual(["real"]);
  });
});
