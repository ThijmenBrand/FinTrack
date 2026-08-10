import { describe, it, expect } from "vitest";
import { placeCard } from "./onboarding-tour";

const VW = 1280;
const VH = 800;

describe("placeCard", () => {
  it("centers when there is nothing to point at", () => {
    const s = placeCard(null, VW, VH);
    expect(s.left).toBe((VW - 340) / 2);
    expect(s.top).toBeGreaterThan(0);
  });

  it("sits below an anchor near the top", () => {
    const s = placeCard({ top: 80, left: 600, width: 120, height: 40 }, VW, VH);
    expect(s.top).toBe(80 + 40 + 14);
    expect(s.bottom).toBeUndefined();
  });

  it("flips above an anchor near the bottom", () => {
    const s = placeCard({ top: 700, left: 600, width: 120, height: 40 }, VW, VH);
    expect(s.bottom).toBe(VH - 700 + 14);
    expect(s.top).toBeUndefined();
  });

  it("clamps a left-edge anchor into view", () => {
    const s = placeCard({ top: 100, left: 0, width: 40, height: 40 }, VW, VH);
    expect(s.left).toBe(12);
  });

  it("clamps a right-edge anchor into view", () => {
    const s = placeCard({ top: 100, left: VW - 40, width: 40, height: 40 }, VW, VH);
    expect(Number(s.left) + Number(s.width)).toBeLessThanOrEqual(VW - 12);
  });

  it("never overflows a narrow phone viewport", () => {
    const s = placeCard({ top: 100, left: 300, width: 60, height: 40 }, 360, 640);
    expect(s.width).toBe(336);
    expect(s.left).toBe(12);
  });
});
