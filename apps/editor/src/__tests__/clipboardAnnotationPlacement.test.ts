import { describe, expect, it } from "vitest";
import type { ChordSymbol, DynamicGroup, NoteEvent, Score } from "@viritura/core";
import { buildClipboardSelection } from "../clipboard/buildClipboardSelection";
import { deserializeFragment } from "../clipboard/deserialize";
import { serializeFragment } from "../clipboard/serialize";
import { applyPaste, pasteResultFromFragment, type PasteResult } from "../commands/clipboardCommands";

function note(id: string, base: "whole" | "quarter" = "whole"): NoteEvent {
  return { type: "event", id, duration: { base }, notes: [{ id: `${id}-note`, pitch: { step: "C", octave: 4 } }] };
}

function score(staves: number[]): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m0", time: { count: 4, unit: 4 } }] },
    parts: staves.map((count, part) => ({
      staves: count,
      measures: [
        {
          sequences: Array.from({ length: count }, (_, staff) => ({
            staff: staff + 1,
            content: [note(`p${part}-staff${staff + 1}`)],
          })),
        },
      ],
    })),
  };
}

function dynamic(id: string, staff?: number): DynamicGroup {
  return { id, type: "immediate", value: "mf", staff, position: { fraction: [0, 1] } };
}

function harmony(step: "C" | "D" | "E" = "C"): ChordSymbol {
  return { position: { fraction: [0, 1] }, root: { step }, quality: "major" };
}

function copyMeasures(source: Score): PasteResult {
  const selection = buildClipboardSelection(source, {
    kind: "measure",
    startPartIndex: 0,
    endPartIndex: source.parts.length - 1,
    startMeasure: 0,
    endMeasure: 0,
  })!;
  const fragment = deserializeFragment(
    serializeFragment(
      selection.events,
      selection.timeSignature,
      selection.keySignature,
      selection.tracks,
      selection.clef,
      selection.transposition,
      selection.dynamics,
      selection.measureRepeats,
      undefined,
      selection.chordSymbols,
    ),
  )!;
  return pasteResultFromFragment(fragment);
}

describe("clipboard physical annotation destinations", () => {
  it.each([undefined, 1])("moves staff %s notes and dynamics to piano staff 2 with global harmony", (staff) => {
    const source = score([1]);
    source.parts[0]!.measures[0]!.dynamics = [dynamic("source-dynamic", staff)];
    source.global.measures[0]!.chordSymbols = [harmony("E")];
    const target = score([2]);
    const laterHarmony: ChordSymbol = { ...harmony("C"), position: { fraction: [1, 2] } };
    target.global.measures[0]!.chordSymbols = [harmony("D"), laterHarmony];
    target.parts[0]!.chordSymbolVisibility = "hide";
    const original = structuredClone(target);
    const paste = copyMeasures(source);
    const pasteSnapshot = structuredClone(paste);

    const result = applyPaste(target, paste, 0, 0, 1, 0);
    const measure = result.parts[0]!.measures[0]!;
    expect(measure.sequences[0]).toEqual(original.parts[0]!.measures[0]!.sequences[0]);
    expect(measure.sequences[1]!.content[0]).toMatchObject({ id: (paste.content[0] as NoteEvent).id });
    expect(measure.dynamics).toHaveLength(1);
    expect(measure.dynamics![0]).toMatchObject({ staff: 2, value: "mf" });
    expect(measure.dynamics![0]!.id).not.toBe("source-dynamic");
    expect(result.global.measures[0]!.chordSymbols).toEqual([harmony("E"), laterHarmony]);
    expect(result.parts[0]!.chordSymbolVisibility).toBe("show");
    expect(measure).not.toHaveProperty("chordSymbols");
    expect(target).toEqual(original);
    expect(paste).toEqual(pasteSnapshot);
  });

  it.each([false, true])("maps piano annotations into separate parts (dynamics: %s)", (withDynamics) => {
    const source = score([2]);
    source.global.measures[0]!.chordSymbols = [harmony("C")];
    if (withDynamics) {
      source.parts[0]!.measures[0]!.dynamics = [dynamic("upper", 1), dynamic("lower", 2)];
    }
    const paste = copyMeasures(source);
    const target = score([1, 1]);
    for (const part of target.parts) part.chordSymbolVisibility = "hide";
    const result = applyPaste(target, paste, 0, 0, 0, 0);
    expect(result.global.measures[0]!.chordSymbols).toEqual([harmony("C")]);
    for (const [partIndex, part] of result.parts.entries()) {
      const measure = part.measures[0]!;
      expect(measure).not.toHaveProperty("chordSymbols");
      expect(part.chordSymbolVisibility).toBe("show");
      expect(measure.sequences[0]!.content[0]).toMatchObject({
        id: (paste.tracks![partIndex]!.content[0] as NoteEvent).id,
      });
      if (withDynamics) {
        expect(measure.dynamics).toHaveLength(1);
        expect(measure.dynamics![0]).toMatchObject({ staff: 1 });
      }
    }
  });

  it.each([false, true])("maps separate parts' annotations into piano staves (dynamics: %s)", (withDynamics) => {
    const source = score([1, 1]);
    source.global.measures[0]!.chordSymbols = [harmony("C")];
    for (const [partIndex, part] of source.parts.entries()) {
      part.chordSymbolVisibility = "show";
      if (withDynamics) part.measures[0]!.dynamics = [dynamic(`dynamic-${partIndex}`)];
    }
    const result = applyPaste(score([2]), copyMeasures(source), 0, 0, 0, 0);
    const measure = result.parts[0]!.measures[0]!;
    expect(result.global.measures[0]!.chordSymbols).toEqual([harmony("C")]);
    expect(measure).not.toHaveProperty("chordSymbols");
    expect(result.parts[0]!.chordSymbolVisibility).toBe("show");
    if (withDynamics) expect(measure.dynamics?.map((item) => item.staff)).toEqual([1, 2]);
  });

  it.each([false, true])("maps a lower source staff at physical zero (dynamics: %s)", (withDynamics) => {
    const sourceDynamic = dynamic("lower", 2);
    const pasted = note("lower-source");
    const paste: PasteResult = {
      content: [pasted],
      tracks: [
        {
          partOffset: 0,
          staffOffset: 0,
          sourceStaff: 2,
          voiceIndex: 0,
          content: [pasted],
          ...(withDynamics ? { dynamics: [{ measureOffset: 0, dynamic: sourceDynamic }] } : {}),
        },
      ],
      chordSymbols: [{ measureOffset: 0, staffOffset: 0, sourceStaff: 2, chordSymbol: harmony("D") }],
    };
    const result = applyPaste(score([1]), paste, 0, 0, 0, 0);
    if (withDynamics) expect(result.parts[0]!.measures[0]!.dynamics![0]!.staff).toBe(1);
    expect(result.global.measures[0]!.chordSymbols).toEqual([harmony("D")]);
    expect(result.parts[0]!.chordSymbolVisibility).toBe("show");
  });

  it("routes top-level dynamics through physical tracks rather than source part offsets", () => {
    const source = score([1, 1]);
    source.parts[1]!.measures[0]!.dynamics = [dynamic("lower")];
    const paste = copyMeasures(source);
    paste.dynamics = [{ partOffset: 1, measureOffset: 0, dynamic: dynamic("fallback") }];
    for (const track of paste.tracks!) delete track.dynamics;
    const result = applyPaste(score([2]), paste, 0, 0, 0, 0);
    expect(result.parts[0]!.measures[0]!.dynamics).toMatchObject([{ staff: 2, value: "mf" }]);
  });

  it("keeps gradual dynamic endpoints while moving their display staff", () => {
    const source = score([1]);
    source.parts[0]!.measures[0]!.dynamics = [
      {
        id: "hairpin",
        type: "gradual",
        wedgeType: "increasing",
        staff: 1,
        position: { fraction: [0, 1] },
        end: { measure: "m0", position: { fraction: [3, 4] } },
      },
    ];
    const target = score([2]);
    target.global.measures[0]!.id = "target-measure";
    const result = applyPaste(target, copyMeasures(source), 0, 0, 1, 0);
    expect(result.parts[0]!.measures[0]!.dynamics![0]).toMatchObject({
      type: "gradual",
      staff: 2,
      end: { measure: "target-measure", position: { fraction: [12, 16] } },
    });
  });

  it("preserves pure annotation and legacy track staff/part routing", () => {
    const target = score([2, 2]);
    const annotationPaste: PasteResult = {
      content: [],
      dynamics: [{ partOffset: 1, measureOffset: 0, dynamic: dynamic("legacy", 2) }],
      chordSymbols: [{ partOffset: 1, measureOffset: 0, sourceStaff: 2, chordSymbol: harmony() }],
    };
    for (const tracks of [undefined, [{ partOffset: 0, voiceIndex: 0, content: [] }]]) {
      const result = applyPaste(target, { ...annotationPaste, tracks }, 0, 0, 0, 0);
      expect(result.parts[0]).toEqual(target.parts[0]);
      expect(result.parts[1]!.measures[0]!.sequences).toEqual(target.parts[1]!.measures[0]!.sequences);
      expect(result.parts[1]!.measures[0]!.dynamics![0]!.staff).toBe(2);
      expect(result.global.measures[0]!.chordSymbols).toEqual([harmony()]);
      expect(result.parts[1]!.chordSymbolVisibility).toBe("show");
      expect(result.parts[1]!.measures[0]).not.toHaveProperty("chordSymbols");
    }
  });
});

describe("clipboard annotation-only tracks", () => {
  it("pastes an upper quarter and lower dynamic at beat 1 without splitting a lower whole note", () => {
    const source = score([2]);
    source.parts[0]!.measures[0]!.sequences[0]!.content = [note("upper", "quarter")];
    source.parts[0]!.measures[0]!.dynamics = [dynamic("lower-dynamic", 2)];
    const selection = buildClipboardSelection(source, {
      kind: "multi",
      elementIds: ["p0/m0/s0/upper", "p0/m0/dynlower-dynamic"],
    })!;
    expect(selection.tracks?.[1]?.content).toEqual([]);
    const target = score([2]);
    target.parts[0]!.measures[0]!.sequences[0]!.content = [
      note("prefix", "quarter"),
      note("replace", "quarter"),
      note("tail-a", "quarter"),
      note("tail-b", "quarter"),
    ];
    const original = structuredClone(target);
    const result = applyPaste(
      target,
      {
        content: selection.events,
        tracks: selection.tracks,
        dynamics: selection.dynamics,
      },
      0,
      0,
      0,
      1,
    );
    const measure = result.parts[0]!.measures[0]!;
    expect(measure.sequences[1]).toEqual(original.parts[0]!.measures[0]!.sequences[1]);
    expect(measure.sequences[0]!.content[1]).toMatchObject({ id: "upper" });
    expect(measure.dynamics).toMatchObject([{ staff: 2, position: { fraction: [4, 16] } }]);
    expect(target).toEqual(original);
  });

  it.each([false, true])("does not create an empty annotation voice (physical: %s)", (physical) => {
    const target = score([2]);
    const original = structuredClone(target);
    const result = applyPaste(
      target,
      {
        content: [],
        tracks: [
          {
            partOffset: 0,
            voiceIndex: 4,
            ...(physical ? { staffOffset: 1 } : {}),
            leadIn: [8, 1],
            content: [],
            dynamics: [{ measureOffset: 0, dynamic: dynamic("annotation", 2) }],
          },
        ],
      },
      0,
      0,
      0,
      0,
    );
    expect(result.global).toEqual(original.global);
    expect(result.parts[0]!.measures[0]!.sequences).toEqual(original.parts[0]!.measures[0]!.sequences);
    expect(result.parts[0]!.measures).toHaveLength(1);
    expect(result.parts[0]!.measures[0]!.dynamics![0]!.staff).toBe(2);
  });

  it("does not pad an empty lower sequence to the upper paste beat", () => {
    const target = score([2]);
    target.parts[0]!.measures[0]!.sequences[0]!.content = [note("prefix", "quarter")];
    target.parts[0]!.measures[0]!.sequences[1]!.content = [];
    const result = applyPaste(
      target,
      {
        content: [],
        tracks: [
          {
            partOffset: 0,
            staffOffset: 1,
            voiceIndex: 0,
            content: [],
            dynamics: [{ measureOffset: 0, dynamic: dynamic("lower", 2) }],
          },
        ],
      },
      0,
      0,
      0,
      1,
    );
    expect(result.parts[0]!.measures[0]!.sequences).toEqual(target.parts[0]!.measures[0]!.sequences);
    expect(result.parts[0]!.measures[0]!.dynamics![0]!.position.fraction).toEqual([4, 16]);
  });
});
