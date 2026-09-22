import { describe, expect, it, vi } from "vitest";
import { parseChordSymbolText, type ChordSymbol, type Score } from "@viritura/core";
import { parseMnx, serializeMnx, validateRawScore } from "@viritura/format";
import { MnxYjsBridge } from "@viritura/crdt";
import { convertMusicXmlToMnx } from "@viritura/musicxml";
import { applyPaste, type PasteResult } from "../commands/clipboardCommands";
import { createHistoryStore } from "../store/historyStore";
import type { CapturedChordSymbol } from "./ClipboardFragment";
import { buildClipboardSelection } from "./buildClipboardSelection";
import { computePasteResult } from "./computePasteResult";

function chord(text: string, fraction: [number, number] = [0, 1]): ChordSymbol {
  return parseChordSymbolText(text, { fraction });
}

function destination(staves = [1, 1]): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "root-measure", time: { count: 4, unit: 4 } }] },
    parts: staves.map((count, index) => ({
      id: `root-part-${index}`,
      staves: count,
      chordSymbolVisibility: "hide",
      transposition: { interval: { halfSteps: 7, staffDistance: 4 } },
      measures: [
        {
          sequences: Array.from({ length: count }, (_, staff) => ({
            staff: staff + 1,
            content: [{ type: "event", id: `rest-${index}-${staff}`, duration: { base: "whole" }, rest: {} }],
          })),
        },
      ],
    })),
    layouts: [{ id: "extracted", content: [{ type: "staff", sources: [{ part: "root-part-0" }] }] }],
    scores: [{ name: "Extracted part", layout: "extracted" }],
  };
}

function captured(text: string, staffOffset: number, fraction: [number, number] = [1, 4]): CapturedChordSymbol {
  return { staffOffset, partOffset: staffOffset, measureOffset: 0, offset: fraction, chordSymbol: chord(text) };
}

describe("global harmony paste transactions", () => {
  it.each([{ staves: [1, 1] }, { staves: [2] }])(
    "keeps the topmost physical source in $staves, replacing only incoming exact onsets",
    ({ staves }) => {
      const score = destination(staves);
      const untouched = chord("G7", [3, 4]);
      // A nearby representable fraction is not an equivalent onset.
      const near = chord("F", [1000000000000001, 4000000000000000]);
      score.global.measures[0]!.chordSymbols = [chord("E", [2, 8]), near, untouched];
      const snapshot = structuredClone(score);
      const warning = vi.fn();
      const next = applyPaste(
        score,
        {
          content: [],
          chordSymbols: [captured("Dm", 1, [2, 8]), captured("C", 0)],
        },
        0,
        0,
        0,
        0,
        undefined,
        undefined,
        warning,
      );
      expect(next.global.measures[0]!.chordSymbols).toEqual([chord("C", [1, 4]), near, untouched]);
      expect(warning).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/topmost/));
      expect(next.parts.every((part) => part.chordSymbolVisibility === "show")).toBe(true);
      expect(next.global.measures[0]!.id).toBe("root-measure");
      expect(next.parts.map((part) => part.id)).toEqual(score.parts.map((part) => part.id));
      expect(next.layouts).toEqual(score.layouts);
      expect(next.scores).toEqual(score.scores);
      expect(score).toEqual(snapshot);
      for (const part of next.parts) expect(part.measures[0]).not.toHaveProperty("chordSymbols");
    },
  );

  it("deduplicates equivalent fractions and harmonic spellings without a conflict warning", () => {
    const warning = vi.fn();
    const next = applyPaste(
      destination(),
      {
        content: [],
        chordSymbols: [captured("Dbmaj7/F", 1, [2, 8]), captured("C#maj7/E#", 0, [3, 12])],
      },
      0,
      0,
      0,
      0,
      undefined,
      undefined,
      warning,
    );
    expect(next.global.measures[0]!.chordSymbols).toEqual([chord("C#maj7/E#", [1, 4])]);
    expect(warning).not.toHaveBeenCalled();
  });

  it("retains unsupported raw text with a warning and selects the global root after chord-only paste", () => {
    const score = destination([1]);
    const result = computePasteResult(
      score,
      { kind: "single", elementId: "p0/m0/s0/rest-0-0" },
      {
        content: [],
        chordSymbols: [captured("mystery harmony", 0)],
      },
    )!;
    expect(result.newScore.global.measures[0]!.chordSymbols?.[0]?.rawText).toBe("mystery harmony");
    expect(result.warnings).toHaveLength(1);
    expect(result.selection).toMatchObject({ kind: "single", elementId: "m0/chord0" });
    expect(result.newScore.parts[0]!.chordSymbolVisibility).toBe("show");
  });

  it("returns conflict warnings from the placement API for the existing UI warning channel", () => {
    const result = computePasteResult(
      destination(),
      { kind: "single", elementId: "p0/m0/s0/rest-0-0" },
      {
        content: [],
        chordSymbols: [captured("D", 1), captured("C", 0)],
      },
    )!;
    expect(result.warnings).toEqual([expect.stringMatching(/topmost/)]);
  });

  it("moves legacy native staff provenance out of canonical harmony before merging", () => {
    const legacy = {
      measureOffset: 0,
      chordSymbol: { ...chord("C7/E"), displayStaff: 2 },
    };
    const snapshot = structuredClone(legacy);
    const next = applyPaste(destination([2]), { content: [], chordSymbols: [legacy] }, 0, 0, 0, 0);
    expect(next.global.measures[0]!.chordSymbols).toEqual([chord("C7/E")]);
    expect(validateRawScore(serializeMnx(next))).toMatchObject({ ok: true });
    expect(legacy).toEqual(snapshot);
  });

  it("retains every deduplicated source part's visibility through split destination mappings", () => {
    const next = applyPaste(
      destination([1, 1, 1]),
      {
        content: [],
        tracks: [
          { partOffset: 0, staffOffset: 0, voiceIndex: 0, content: [] },
          { partOffset: 1, staffOffset: 1, voiceIndex: 0, content: [] },
          { partOffset: 1, staffOffset: 2, voiceIndex: 0, content: [] },
        ],
        chordSymbols: [{ ...captured("C", 0), sourcePartOffsets: [0, 1] }],
      },
      0,
      0,
      0,
      0,
    );
    expect(next.global.measures[0]!.chordSymbols).toHaveLength(1);
    expect(next.parts.map((part) => part.chordSymbolVisibility)).toEqual(["show", "show", "show"]);
  });

  it("keeps invalid fraction and staff data strict and leaves the original score unchanged", () => {
    const score = destination();
    const snapshot = structuredClone(score);
    for (const invalid of [
      { ...captured("C", 0), offset: [1, 0] as [number, number] },
      { ...captured("C", 0), staffOffset: 0.5 },
      {
        ...captured("C", 0),
        chordSymbol: { ...chord("C"), position: { fraction: [0, 1] as [number, number], graceIndex: -1 } },
      },
    ]) {
      expect(() => applyPaste(score, { content: [], chordSymbols: [invalid] }, 0, 0, 0, 0)).toThrow();
      expect(score).toEqual(snapshot);
    }
  });

  it("copies source-written B-flat slash harmony as concert pitch without using destination transposition", () => {
    const source = parseMnx(
      convertMusicXmlToMnx(
        `<score-partwise version="4.0">
      <part-list><score-part id="clarinet"><part-name>Clarinet</part-name></score-part></part-list>
      <part id="clarinet"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
          <transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose></attributes>
        <harmony><root><root-step>C</root-step></root><kind>major</kind><bass><bass-step>E</bass-step></bass></harmony>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
      </measure></part></score-partwise>`,
        { includeVendorExtensions: true },
      ),
    );
    const copied = buildClipboardSelection(source, {
      kind: "measure",
      startPartIndex: 0,
      endPartIndex: 0,
      startMeasure: 0,
      endMeasure: 0,
    })!;
    expect(copied.chordSymbols).toHaveLength(1);
    const next = applyPaste(
      destination([1]),
      { content: copied.events, chordSymbols: copied.chordSymbols },
      0,
      0,
      0,
      0,
    );
    expect(next.global.measures[0]!.chordSymbols?.[0]).toMatchObject({
      root: { step: "B", alter: -1 },
      bass: { step: "D" },
    });
    expect(next.parts[0]!.transposition?.interval.halfSteps).toBe(7);
  });

  it("publishes notes, global harmony and visibility in one collaboration transaction and one undo entry", () => {
    const score = destination([1]);
    const before = JSON.stringify(serializeMnx(score));
    const bridge = new MnxYjsBridge();
    bridge.setMnxJson(before);
    const observed = vi.fn();
    bridge.doc.on("update", observed);
    const restored = vi.fn();
    const history = createHistoryStore(before, { current: restored });
    const paste: PasteResult = {
      content: [
        {
          type: "event",
          id: "pasted-note",
          duration: { base: "whole" },
          notes: [{ id: "note-root", pitch: { step: "B", alter: -1, octave: 3 } }],
        },
      ],
      chordSymbols: [captured("Bb/D", 0)],
    };
    const next = applyPaste(score, paste, 0, 0, 0, 0);
    const wire = serializeMnx(next);
    expect(validateRawScore(wire)).toMatchObject({ ok: true });
    const after = JSON.stringify(wire);
    bridge.setMnxJson(after);
    history.getState().pushState(after, "Paste");
    expect(observed).toHaveBeenCalledTimes(1);
    expect(JSON.parse(bridge.getMnxJson())).toEqual(wire);
    expect(history.getState().historySize).toBe(2);
    const undo = history.getState().undo()!;
    expect(undo).toBe(before);
    expect(parseMnx(JSON.parse(undo))).toEqual(parseMnx(JSON.parse(before)));
    expect(restored).toHaveBeenCalledTimes(1);
    expect(history.getState().redo()).toBe(after);
    bridge.doc.destroy();
  });
});
