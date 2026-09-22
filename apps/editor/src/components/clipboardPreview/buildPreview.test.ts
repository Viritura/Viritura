import { describe, expect, it } from "vitest";
import type { ClipboardFragment } from "../../clipboard/ClipboardFragment";
import { FRAGMENT_VERSION } from "../../clipboard/ClipboardFragment";
import { buildPreviewScore } from "./buildPreview";

function chordSymbolFragment(): ClipboardFragment {
  return {
    type: "viritura/fragment",
    version: FRAGMENT_VERSION,
    timeSignature: { count: 4, unit: 4 },
    keySignature: { fifths: 0 },
    content: [],
    chordSymbols: [
      {
        measureOffset: 0,
        offset: [0, 1],
        chordSymbol: {
          position: { fraction: [0, 1] },
          root: { step: "G" },
          bass: { step: "B" },
        },
      },
    ],
  };
}

describe("clipboard preview score", () => {
  it("renders annotation-only chord-symbol fragments", () => {
    const score = buildPreviewScore(chordSymbolFragment());

    expect(score.global.measures[0]!.chordSymbols).toEqual([
      {
        position: { fraction: [0, 1] },
        root: { step: "G" },
        bass: { step: "B" },
      },
    ]);
    expect(score.parts[0]!.chordSymbolVisibility).toBe("show");
  });

  it("places chord-symbol offsets across preview measures", () => {
    const fragment = chordSymbolFragment();
    fragment.chordSymbols![0]!.offset = [5, 4];

    const score = buildPreviewScore(fragment);

    expect(score.global.measures).toHaveLength(2);
    expect(score.global.measures[1]!.chordSymbols![0]!.position.fraction).toEqual([1, 4]);
  });
});
