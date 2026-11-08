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
  it("keeps piano tracks on separate staves instead of displaying the lower staff as voice 2", () => {
    const fragment = chordSymbolFragment();
    delete fragment.chordSymbols;
    fragment.tracks = [1, 2].map((staff) => ({
      partOffset: 0,
      voiceIndex: 0,
      staffOffset: staff - 1,
      sourceStaff: staff,
      clef: staff === 1 ? { sign: "G", staffPosition: -2 } : { sign: "F", staffPosition: 2 },
      content: [
        {
          type: "event",
          duration: { base: "whole" },
          notes: [{ pitch: { step: "C", octave: staff === 1 ? 5 : 3 } }],
        },
      ],
    }));
    fragment.content = fragment.tracks[0]!.content;
    const preview = buildPreviewScore(fragment);
    expect(preview.parts).toHaveLength(1);
    expect(preview.parts[0]!.staves).toBe(2);
    expect(preview.parts[0]!.measures[0]!.sequences.map((sequence) => sequence.staff)).toEqual([1, 2]);
    expect(preview.parts[0]!.measures[0]!.clefs).toMatchObject([
      { staff: 1, clef: { sign: "G" } },
      { staff: 2, clef: { sign: "F" } },
    ]);
  });

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
