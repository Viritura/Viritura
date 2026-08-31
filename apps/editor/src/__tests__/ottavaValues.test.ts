import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("ottava button values", () => {
  it("passes MNX-correct octave counts (1/2/-1/-2), not semitone counts", () => {
    const source = readFileSync(resolve(__dirname, "../components/PalettePanel.tsx"), "utf-8");
    // Should have handleAddOttava(1) for 8va, not handleAddOttava(8)
    expect(source).toContain("handleAddOttava(1)");
    expect(source).toContain("handleAddOttava(2)");
    expect(source).toContain("handleAddOttava(-1)");
    expect(source).toContain("handleAddOttava(-2)");
    // Should NOT have the old wrong values
    expect(source).not.toContain("handleAddOttava(8)");
    expect(source).not.toContain("handleAddOttava(15)");
    expect(source).not.toContain("handleAddOttava(-8)");
    expect(source).not.toContain("handleAddOttava(-15)");
  });
});
