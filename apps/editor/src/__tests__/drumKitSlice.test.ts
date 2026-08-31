import { describe, it, expect } from "vitest";
import { buildKitSliceMnx, orderedSliceComponents, slicePageWidth } from "../components/DrumKitDialog/drumKitSlice";
import type { KitComponentEdit } from "../components/DrumKitDialog/types";

// buildKitSliceMnx returns an untyped MNX object (fed to the WASM parser); the
// assertions probe its runtime shape, so `any` is used deliberately here.
/* eslint-disable @typescript-eslint/no-explicit-any */

function row(over: Partial<KitComponentEdit> & { id: string }): KitComponentEdit {
  return { name: over.id, staffPosition: 0, notehead: "normal", drumKit: undefined, midiKey: 38, ...over };
}

describe("buildKitSliceMnx", () => {
  it("orders components top-of-staff first", () => {
    const rows = [
      row({ id: "a", staffPosition: -4 }),
      row({ id: "b", staffPosition: 6 }),
      row({ id: "c", staffPosition: 0 }),
    ];
    expect(orderedSliceComponents(rows).map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("builds a percussion part with one kit-note per component in staff order", () => {
    const rows = [
      row({ id: "snare", staffPosition: 1, midiKey: 38 }),
      row({ id: "crash", staffPosition: 6, notehead: "x", midiKey: 49 }),
    ];
    const slice = buildKitSliceMnx(rows) as any;
    const part = slice.parts[0];

    expect(Object.keys(part.kit).sort()).toEqual(["crash", "snare"]);
    // Crash (sp 6) is the first (leftmost) event.
    const content = part.measures[0].sequences[0].content;
    expect(content.map((c: any) => c.kitNotes[0].kitComponent)).toEqual(["crash", "snare"]);
    // Notehead shape is carried as the Viritura vendor extension.
    expect(part.kit.crash._x.viritura.notehead).toBe("x");
    expect(part.kit.snare._x).toBeUndefined(); // "normal" omitted
    // Sounds carry the chosen MIDI keys.
    expect(slice.global.sounds["snd-crash"].midiNumber).toBe(49);
    // Percussion clef present.
    expect(part.measures[0].clefs[0].clef.glyph).toBe("unpitchedPercussionClef1");
  });

  it("emits a whole rest when there are no components so the staff still renders", () => {
    const slice = buildKitSliceMnx([]) as any;
    const content = slice.parts[0].measures[0].sequences[0].content;
    expect(content).toHaveLength(1);
    expect(content[0].rest).toBeDefined();
    expect(Object.keys(slice.parts[0].kit)).toHaveLength(0);
  });

  it("scales page width with component count", () => {
    expect(slicePageWidth(0)).toBeLessThan(slicePageWidth(8));
  });
});
