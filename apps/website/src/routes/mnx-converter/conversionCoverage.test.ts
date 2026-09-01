import { describe, expect, it } from "vitest";
import {
  LIMITED_MUSICXML_COVERAGE,
  SUPPORTED_TARGET_IMPORT_GAPS,
  VIRITURA_EXTENSION_COVERAGE,
} from "./conversionCoverage";

function names(items: readonly { name: string }[]): string[] {
  return items.map((item) => item.name);
}

describe("MusicXML conversion coverage", () => {
  it("does not claim importer gaps are preserved by enabling extensions", () => {
    const extensionNames = names(VIRITURA_EXTENSION_COVERAGE);
    expect(extensionNames).not.toContain("Shake ornament");
    expect(extensionNames).not.toContain("Non-arpeggiate");
    expect(extensionNames).toEqual(expect.arrayContaining(["Glissando and slide", "Chord symbols", "Coda"]));

    expect(names(SUPPORTED_TARGET_IMPORT_GAPS)).toEqual(["Advanced chord-symbol details", "Font and element styling"]);
    expect(names(LIMITED_MUSICXML_COVERAGE)).toEqual([
      "Shake ornament",
      "Figured bass",
      "Other technical notation",
      "Guitar bends",
      "Stemless and double stems",
    ]);
  });
});
