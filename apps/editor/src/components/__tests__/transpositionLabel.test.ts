import { describe, it, expect } from "vitest";
import { formatTranspositionLabel } from "../transpositionLabel";
import { getCatalogInstrument } from "../../score/InstrumentCatalog";

describe("formatTranspositionLabel", () => {
  it("shows the instrument key (pitch sounding for a written C)", () => {
    expect(formatTranspositionLabel(2)).toBe("B♭"); // B♭ clarinet/trumpet
    expect(formatTranspositionLabel(3)).toBe("A"); // A clarinet
    expect(formatTranspositionLabel(5)).toBe("G"); // alto flute
    expect(formatTranspositionLabel(7)).toBe("F"); // English Horn / Horn in F
    expect(formatTranspositionLabel(9)).toBe("E♭"); // alto sax
    expect(formatTranspositionLabel(14)).toBe("B♭"); // bass clarinet / tenor sax
    expect(formatTranspositionLabel(21)).toBe("E♭"); // baritone sax
  });

  it("handles instruments that sound higher (negative halfSteps)", () => {
    expect(formatTranspositionLabel(-3)).toBe("E♭"); // E♭ clarinet (sounds m3 higher)
  });

  it("labels whole-octave displacement as a register shift, not a key", () => {
    expect(formatTranspositionLabel(12)).toBe("−1 oct"); // contrabassoon
    expect(formatTranspositionLabel(-12)).toBe("+1 oct"); // piccolo
  });

  it("returns an empty label for non-transposing instruments", () => {
    expect(formatTranspositionLabel(0)).toBe("");
  });

  // Regression: English Horn and Horn in F previously mislabeled "B♭ bass".
  it("matches the catalog for English Horn and Horn in F", () => {
    for (const id of ["english-horn", "horn"]) {
      const inst = getCatalogInstrument(id);
      expect(inst?.transposition?.halfSteps).toBe(7);
      expect(formatTranspositionLabel(inst!.transposition!.halfSteps)).toBe("F");
    }
  });
});
