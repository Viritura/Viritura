import { describe, expect, it } from "vitest";
import { canonicalNavigationId, globalChordNavigationId } from "../navigation";
import { canonicalChordSymbolId, chordSymbolId } from "../score/ElementPath";

describe("central chord navigation identity", () => {
  it("reuses the central global constructor", () => {
    expect(globalChordNavigationId).toBe(chordSymbolId);
    expect(globalChordNavigationId(0, 0)).toBe("m0/chord0");
    expect(globalChordNavigationId(12, 3)).toBe("m12/chord3");
  });

  it.each(["m12/chord3", "m12/chord3/p0/staff1", "m12/chord3/p9/staff2"])(
    "uses the central canonical identity for %s",
    (id) => {
      expect(canonicalNavigationId(id)).toBe(canonicalChordSymbolId(id));
      expect(canonicalNavigationId(id)).toBe("m12/chord3");
    },
  );

  it.each(["p0/m12/chord3", "g/m12/chord3", "m12/chord", "m12/chord3/p0", "p0/m12/s0/e0", "m12/tempo0"])(
    "leaves noncanonical chord and unrelated IDs unchanged: %s",
    (id) => {
      expect(canonicalNavigationId(id)).toBe(id);
    },
  );
});
