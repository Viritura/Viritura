import { describe, it, expect } from "vitest";
import { BREATH_FERMATA_ITEMS, resolveBreathFermata } from "../radialMenu/breathFermataMenu";

describe("resolveBreathFermata", () => {
  it("resolves breath-comma to breath kind", () => {
    const r = resolveBreathFermata("breath-comma");
    expect(r).toEqual({ kind: "breath", symbol: "comma" });
  });

  it("resolves breath-tick to breath kind", () => {
    const r = resolveBreathFermata("breath-tick");
    expect(r).toEqual({ kind: "breath", symbol: "tick" });
  });

  it("resolves the remaining standard breath symbols", () => {
    expect(resolveBreathFermata("breath-upbow")).toEqual({ kind: "breath", symbol: "upbow" });
    expect(resolveBreathFermata("breath-salzedo")).toEqual({ kind: "breath", symbol: "salzedo" });
  });

  it("resolves caesura", () => {
    const r = resolveBreathFermata("caesura");
    expect(r).toEqual({ kind: "caesura" });
  });

  it("resolves fermata-normal", () => {
    const r = resolveBreathFermata("fermata-normal");
    expect(r).toEqual({ kind: "fermata", shape: "normal" });
  });

  it("resolves fermata-angled", () => {
    const r = resolveBreathFermata("fermata-angled");
    expect(r).toEqual({ kind: "fermata", shape: "angled" });
  });

  it("resolves fermata-square", () => {
    const r = resolveBreathFermata("fermata-square");
    expect(r).toEqual({ kind: "fermata", shape: "square" });
  });

  it("resolves fermata-double-dot", () => {
    const r = resolveBreathFermata("fermata-double-dot");
    expect(r).toEqual({ kind: "fermata", shape: "doubleDot" });
  });

  it("returns null for unknown id", () => {
    expect(resolveBreathFermata("nonexistent")).toBeNull();
    expect(resolveBreathFermata("")).toBeNull();
  });
});

describe("item list", () => {
  it("BREATH_FERMATA_ITEMS contains all 9 items", () => {
    expect(BREATH_FERMATA_ITEMS).toHaveLength(9);
    const ids = BREATH_FERMATA_ITEMS.map((i) => i.id);
    expect(ids).toContain("breath-comma");
    expect(ids).toContain("breath-tick");
    expect(ids).toContain("breath-upbow");
    expect(ids).toContain("breath-salzedo");
    expect(ids).toContain("caesura");
    expect(ids).toContain("fermata-normal");
    expect(ids).toContain("fermata-angled");
    expect(ids).toContain("fermata-square");
    expect(ids).toContain("fermata-double-dot");
  });

  it("all items have icons and labels", () => {
    for (const item of BREATH_FERMATA_ITEMS) {
      expect(item.icon).toBeTruthy();
      expect(item.label).toBeTruthy();
    }
  });
});
