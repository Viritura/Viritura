import { describe, expect, it } from "vitest";
import { parseChordSymbolText, resolveChordSymbol, type Score } from "@viritura/core";
import { editChordTrackText, removeChordTrackChord, scoreTrackChords, moveChordTrackChord } from "./chordTrackEdits";

function score(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          time: { count: 4, unit: 4 },
          chordSymbols: [
            parseChordSymbolText("Cmaj7", { fraction: [0, 1] }),
            parseChordSymbolText("G7/B", { fraction: [1, 2] }),
          ],
        },
      ],
    },
    parts: [
      {
        id: "clarinet",
        name: "Clarinet",
        chordSymbolVisibility: "hide",
        transposition: { interval: { halfSteps: 2, staffDistance: 1 } },
        measures: [{ sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }] }],
      },
    ],
    scores: [{ name: "Written", useWritten: true }],
  };
}

describe("concert-pitch chord-track document edits", () => {
  it("moves a complete chord and replaces an occupied destination without touching notes", () => {
    const original = score();
    original.global.measures[0]!.chordSymbols![0]!.textOverride = "Cmaj7";
    const source = scoreTrackChords(original)[0]!;
    const next = moveChordTrackChord(original, source, { measureIndex: 0, beat: 2, x: 300 });
    expect(next.global.measures[0]!.chordSymbols).toEqual([{ ...source.symbol, position: { fraction: [1, 2] } }]);
    expect(next.parts).toBe(original.parts);
    expect(original.global.measures[0]!.chordSymbols).toHaveLength(2);
  });

  it("moves between measures and leaves unrelated harmony intact", () => {
    const original = score();
    original.global.measures.push({});
    const source = scoreTrackChords(original)[0]!;
    const next = moveChordTrackChord(original, source, { measureIndex: 1, beat: 1, x: 500 });
    expect(next.global.measures[0]!.chordSymbols![0]!.rawText).toBe("G7/B");
    expect(next.global.measures[1]!.chordSymbols).toEqual([{ ...source.symbol, position: { fraction: [1, 4] } }]);
  });

  it("treats an unchanged drop as a no-op and rejects stale sources", () => {
    const original = score();
    const source = scoreTrackChords(original)[0]!;
    expect(moveChordTrackChord(original, source, { measureIndex: 0, beat: 0, x: 100 })).toBe(original);
    const edited = editChordTrackText(original, { measureIndex: 0, beat: 0, x: 100 }, "Dm7");
    expect(() => moveChordTrackChord(edited, source, { measureIndex: 0, beat: 1, x: 200 })).toThrow(
      "changed while dragging",
    );
    expect(() => moveChordTrackChord(original, source, { measureIndex: 99, beat: 0, x: 0 })).toThrow();
  });

  it("inserts at an empty rhythmic position without an event or visibility mutation", () => {
    const original = score();
    const next = editChordTrackText(original, { measureIndex: 0, beat: 1, x: 123 }, "F#maj7/A#");
    expect(next.parts).toBe(original.parts);
    expect(next.global.measures[0]!.chordSymbols).toHaveLength(3);
    expect(next.global.measures[0]!.chordSymbols![1]!.position.fraction).toEqual([1, 4]);
    expect(next.global.measures[0]!.chordSymbols![1]!.root).toEqual({ step: "F", alter: 1 });
    expect(next.global.measures[0]!.chordSymbols![1]!.bass).toEqual({ step: "A", alter: 1 });
    expect(original.global.measures[0]!.chordSymbols).toHaveLength(2);
  });

  it("replaces an exact rational onset and preserves neighboring changes", () => {
    const original = score();
    const next = editChordTrackText(
      original,
      { measureIndex: 0, beat: 2, x: 0, position: { fraction: [2, 4] } },
      "Dm7",
    );
    expect(next.global.measures[0]!.chordSymbols).toHaveLength(2);
    expect(next.global.measures[0]!.chordSymbols![0]).toBe(original.global.measures[0]!.chordSymbols![0]);
    expect(next.global.measures[0]!.chordSymbols![1]!.rawText).toBe("Dm7");
    expect(next.global.measures[0]!.chordSymbols![1]!.position.fraction).toEqual([1, 2]);
  });

  it("retains unsupported text and deletes only the selected harmony", () => {
    const original = score();
    const unsupported = editChordTrackText(original, { measureIndex: 0, beat: 0, x: 0 }, "C7b9");
    expect(resolveChordSymbol(unsupported.global.measures[0]!.chordSymbols![0]!).status).toBe("unsupported");
    const next = removeChordTrackChord(unsupported, { measureIndex: 0, beat: 0, x: 0 });
    expect(next.parts).toBe(original.parts);
    expect(next.global.measures[0]!.chordSymbols!.map((chord) => chord.rawText)).toEqual(["G7/B"]);
    expect(scoreTrackChords(next)[0]!.elementId).toBe("m0/chord0");
  });

  it("preserves grace changes when editing the main onset and rejects invalid input", () => {
    const original = score();
    original.global.measures[0]!.chordSymbols!.unshift(parseChordSymbolText("F", { fraction: [0, 1], graceIndex: 0 }));
    const next = editChordTrackText(original, { measureIndex: 0, beat: 0, x: 0 }, "Dm7");
    expect(next.global.measures[0]!.chordSymbols![0]!.rawText).toBe("F");
    expect(next.global.measures[0]!.chordSymbols![1]!.rawText).toBe("Dm7");
    expect(() => editChordTrackText(original, { measureIndex: 0, beat: NaN, x: 0 }, "C")).toThrow();
    expect(() => editChordTrackText(original, { measureIndex: 99, beat: 0, x: 0 }, "C")).toThrow();
  });
});
