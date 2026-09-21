import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import {
  applyCut,
  copyToClipboard,
  cutToClipboard,
  pasteResultFromFragment,
  type ClipboardSelection,
} from "../commands/clipboardCommands";
import type { SelectionRhythmicRange, SelectionState } from "../store/selectionStore";
import { buildClipboardSelection } from "./buildClipboardSelection";
import { captureTimedSelection } from "./captureTimedSelection";
import { computePasteResult } from "./computePasteResult";
import { deserializeFragment } from "./deserialize";
import { FRAGMENT_VERSION, VIRITURA_FRAGMENT_TYPE } from "./ClipboardFragment";

function fixture(staves = 1): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          id: "measure-0",
          time: { count: 4, unit: 4 },
          chordSymbols: [{ position: { fraction: [0, 1] }, root: { step: "C" } }],
        },
        { id: "measure-1" },
      ],
    },
    parts: Array.from({ length: 3 }, (_, part) => ({
      id: `part-${part}`,
      staves,
      measures: Array.from({ length: 2 }, (_, measure) => ({
        sequences: Array.from({ length: staves }, (_, staff) => ({
          staff: staff + 1,
          content: [
            {
              type: "event" as const,
              id: `note-${part}-${measure}-${staff + 1}`,
              duration: { base: "whole" as const },
              notes: [{ id: `pitch-${part}-${measure}-${staff + 1}`, pitch: { step: "C" as const, octave: 4 } }],
            },
          ],
        })),
      })),
    })),
  };
}

function useStructuralView(score: Score, part: number, staff: number): void {
  score.layouts = [{ id: "extracted", content: [{ type: "staff", sources: [{ part: `part-${part}`, staff }] }] }];
  score.scores = [{}, { layout: "extracted" }];
}

function noteId(part: number, staff = 1, measure = 0): string {
  return `p${part}/m${measure}/s${staff - 1}/note-${part}-${measure}-${staff}`;
}

function timedSelection(
  parts: number[],
  staff: number,
  chordIds: string[] = [],
): Extract<SelectionState, { kind: "multi" }> & { rhythmicRange: SelectionRhythmicRange } {
  const start = { measureIndex: 0, beat: 0 };
  const end = { measureIndex: 0, beat: 4 };
  return {
    kind: "multi",
    elementIds: [...parts.map((part) => noteId(part, staff)), ...chordIds],
    rhythmicRange: {
      start,
      end,
      tracks: parts.map((partIndex) => ({ partIndex, staff, voice: 0, start, end })),
    },
  };
}

function pastePayload(captured: ClipboardSelection) {
  return pasteResultFromFragment({
    type: VIRITURA_FRAGMENT_TYPE,
    version: FRAGMENT_VERSION,
    content: captured.events,
    tracks: captured.tracks,
    timeSignature: captured.timeSignature,
    keySignature: captured.keySignature,
    chordSymbols: captured.chordSymbols,
  });
}

function expectSingleSource(captured: ClipboardSelection, score: Score, part: number, staff = 1): void {
  const content = score.parts[part]!.measures[0]!.sequences[staff - 1]!.content;
  expect.soft(captured.partIndex).toBe(part);
  expect.soft(captured.sequenceIndex).toBe(staff - 1);
  expect.soft(captured.events).toEqual(content);
  expect.soft(captured.captureOrigin).toEqual({ measureIndex: 0, beat: 0 });
  expect
    .soft(captured.cutLocations)
    .toEqual([{ partIndex: part, measureIndex: 0, sequenceIndex: staff - 1, eventIndex: 0 }]);
  if (captured.tracks) {
    expect.soft(captured.tracks).toHaveLength(1);
    expect.soft(captured.tracks[0]).toMatchObject({ partOffset: 0, staffOffset: 0, sourceStaff: staff, content });
  }
  expect.soft(captured.chordSymbols).toHaveLength(1);
  expect.soft(captured.chordSymbols?.[0]).toMatchObject({
    staffOffset: 0,
    sourcePartOffsets: [0],
    measureOffset: 0,
    offset: [0, 1],
    chordSymbol: score.global.measures[0]!.chordSymbols![0],
  });
  expect.soft(captured.chordSymbols?.[0]?.partOffset ?? 0).toBe(0);
}

const rangeCases = [
  { chordId: "m0/chord0/p2/staff1", reverse: false },
  { chordId: "m0/chord0/p2/staff1", reverse: true },
  { chordId: "m0/chord0", reverse: false },
  { chordId: "m0/chord0", reverse: true },
];

function chordToNoteRange(chordId: string, reverse: boolean): SelectionState {
  return {
    kind: "range",
    startElementId: reverse ? noteId(2) : chordId,
    endElementId: reverse ? chordId : noteId(2),
  };
}

describe("chord range capture in an extracted root part", () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();

  beforeEach(() => {
    writeText.mockReset().mockResolvedValue();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(rangeCases)("captures only root part 2 from $chordId (reverse=$reverse)", ({ chordId, reverse }) => {
    const score = fixture();
    useStructuralView(score, 2, 1);
    const before = structuredClone(score);
    const selection = chordToNoteRange(chordId, reverse);
    const selectionBefore = structuredClone(selection);
    const captured = buildClipboardSelection(score, selection, 1);
    expect(captured).not.toBeNull();
    expectSingleSource(captured!, score, 2);
    expect(score).toEqual(before);
    expect(selection).toEqual(selectionBefore);
  });

  it.each(rangeCases)("copies only the visible note from $chordId (reverse=$reverse)", async ({ chordId, reverse }) => {
    const score = fixture();
    useStructuralView(score, 2, 1);
    const before = structuredClone(score);
    const captured = buildClipboardSelection(score, chordToNoteRange(chordId, reverse), 1);
    expect(captured).not.toBeNull();
    await expect(copyToClipboard(captured!)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledTimes(1);
    const fragment = deserializeFragment(writeText.mock.calls[0]![0]);
    expect(fragment).not.toBeNull();
    const content = score.parts[2]!.measures[0]!.sequences[0]!.content;
    expect.soft(fragment!.content).toEqual(content);
    if (fragment!.tracks) {
      expect.soft(fragment!.tracks).toHaveLength(1);
      expect.soft(fragment!.tracks[0]).toMatchObject({ partOffset: 0, content });
    }
    expect.soft(fragment!.chordSymbols).toHaveLength(1);
    expect.soft(fragment!.chordSymbols?.[0]).toMatchObject({ staffOffset: 0, sourcePartOffsets: [0] });
    expect(score).toEqual(before);
  });

  it.each(rangeCases)("cuts no hidden notes from $chordId (reverse=$reverse)", async ({ chordId, reverse }) => {
    const score = fixture();
    useStructuralView(score, 2, 1);
    const before = structuredClone(score);
    const captured = buildClipboardSelection(score, chordToNoteRange(chordId, reverse), 1);
    expect(captured).not.toBeNull();
    const cut = await cutToClipboard(captured!);
    expect(cut).not.toBeNull();
    expect(writeText).toHaveBeenCalledTimes(1);
    const next = applyCut(score, cut!);
    expect.soft(next.parts.slice(0, 2)).toEqual(before.parts.slice(0, 2));
    expect.soft(next.parts[2]!.measures[0]!.sequences[0]).toEqual({
      staff: 1,
      content: [],
      fullMeasure: { visualDuration: { base: "whole" } },
    });
    expect.soft(next.parts[2]!.measures[1]).toEqual(before.parts[2]!.measures[1]);
    expect.soft(next.global.measures[0]!.chordSymbols ?? []).toEqual([]);
    expect(next.parts.map((part) => part.id)).toEqual(["part-0", "part-1", "part-2"]);
    expect(next.global.measures.map((measure) => measure.id)).toEqual(["measure-0", "measure-1"]);
    expect(next.layouts).toEqual(before.layouts);
    expect(next.scores).toEqual(before.scores);
    expect(score).toEqual(before);
  });
});

function measureSelection(): SelectionState {
  return {
    kind: "measure",
    startPartIndex: 0,
    endPartIndex: 1,
    startStaffIndex: 0,
    endStaffIndex: 1,
    startMeasure: 0,
    endMeasure: 0,
  };
}

describe("chord-to-note ranges preserve structural cut sources", () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();

  beforeEach(() => {
    writeText.mockReset().mockResolvedValue();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { name: "canonical", chordId: "m0/chord0" },
    { name: "rendered", chordId: "m0/chord0/p0/staff1" },
  ])("copies and cuts both condensed unison sources from a $name chord", async ({ chordId }) => {
    const score = fixture();
    score.layouts = [
      {
        id: "condensed",
        content: [{ type: "staff", sources: [{ part: "part-0" }, { part: "part-1" }] }],
      },
    ];
    score.scores = [{}, { layout: "condensed" }];
    const before = structuredClone(score);
    const captured = buildClipboardSelection(
      score,
      { kind: "range", startElementId: chordId, endElementId: noteId(0) },
      1,
    );
    expect(captured).not.toBeNull();
    expect.soft(captured!.tracks).toHaveLength(2);
    for (const part of [0, 1]) {
      expect
        .soft(captured!.tracks?.find((track) => track.partOffset === part)?.content)
        .toEqual(before.parts[part]!.measures[0]!.sequences[0]!.content);
    }
    expect.soft(captured!.cutLocations).toEqual([
      { partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 0 },
      { partIndex: 1, measureIndex: 0, sequenceIndex: 0, eventIndex: 0 },
    ]);
    await expect(copyToClipboard(captured!)).resolves.toBe(true);
    const fragment = deserializeFragment(writeText.mock.calls[0]![0]);
    expect(fragment).not.toBeNull();
    expect.soft(fragment!.tracks).toEqual(captured!.tracks);
    const cut = await cutToClipboard(captured!);
    expect(cut).not.toBeNull();
    const next = applyCut(score, cut!);
    for (const part of [0, 1]) {
      expect.soft(next.parts[part]!.measures[0]!.sequences[0]).toEqual({
        staff: 1,
        content: [],
        fullMeasure: { visualDuration: { base: "whole" } },
      });
      expect.soft(next.parts[part]!.measures[1]).toEqual(before.parts[part]!.measures[1]);
    }
    expect.soft(next.parts[2]).toEqual(before.parts[2]);
    expect.soft(next.global.measures[0]!.chordSymbols ?? []).toEqual([]);
    expect(score).toEqual(before);
  });

  it.each([
    { part: 0, name: "canonical", chordId: "m0/chord0" },
    { part: 2, name: "canonical", chordId: "m0/chord0" },
    { part: 0, name: "rendered", chordId: "m0/chord0/p0/staff2" },
    { part: 2, name: "rendered", chordId: "m0/chord0/p2/staff2" },
  ])("copies and cuts a staff 2 dynamic in root part $part from a $name chord", async ({ part, chordId }) => {
    const score = fixture(2);
    useStructuralView(score, part, 2);
    score.parts.forEach((sourcePart, partIndex) => {
      sourcePart.measures[0]!.dynamics = [1, 2].map((staff) => ({
        id: `dynamic-${partIndex}-${staff}`,
        type: "immediate" as const,
        staff,
        position: { fraction: [1, 2] },
        value: staff === 1 ? "p" : "f",
      }));
    });
    const before = structuredClone(score);
    const captured = buildClipboardSelection(
      score,
      { kind: "range", startElementId: chordId, endElementId: noteId(part, 2, 1) },
      1,
    );
    expect(captured).not.toBeNull();
    const dynamics = before.parts[part]!.measures[0]!.dynamics!;
    const expectLowerDynamic = (items: ClipboardSelection["dynamics"]) => {
      expect.soft(items).toHaveLength(1);
      const dynamic = items?.[0]?.dynamic;
      expect.soft(dynamic).toMatchObject({ id: dynamics[1]!.id, type: "immediate", staff: 2, value: "f" });
      const fraction = dynamic?.position.fraction;
      expect.soft(fraction && fraction[0] / fraction[1]).toBe(0.5);
    };
    expectLowerDynamic(captured!.dynamics);
    expect.soft(captured!.cutAnnotationLocations?.filter((location) => location.kind === "part")).toEqual([
      {
        kind: "part",
        type: "dyn",
        partIndex: part,
        measureIndex: 0,
        annotationId: `dynamic-${part}-2`,
      },
    ]);
    await expect(copyToClipboard(captured!)).resolves.toBe(true);
    const fragment = deserializeFragment(writeText.mock.calls[0]![0]);
    expect(fragment).not.toBeNull();
    expectLowerDynamic(fragment!.dynamics);
    const cut = await cutToClipboard(captured!);
    expect(cut).not.toBeNull();
    const next = applyCut(score, cut!);
    expect.soft(next.parts[part]!.measures[0]!.dynamics).toEqual([dynamics[0]]);
    for (const measure of [0, 1]) {
      expect
        .soft(next.parts[part]!.measures[measure]!.sequences[0])
        .toEqual(before.parts[part]!.measures[measure]!.sequences[0]);
      expect.soft(next.parts[part]!.measures[measure]!.sequences[1]).toEqual({
        staff: 2,
        content: [],
        fullMeasure: { visualDuration: { base: "whole" } },
      });
    }
    for (const hiddenPart of [0, 1, 2].filter((index) => index !== part)) {
      expect.soft(next.parts[hiddenPart]).toEqual(before.parts[hiddenPart]);
    }
    expect.soft(next.global.measures[0]!.chordSymbols ?? []).toEqual([]);
    expect(score).toEqual(before);
  });
});

function expectSharedChord(captured: ClipboardSelection, origins: number[]): void {
  expect.soft(captured.chordSymbols).toHaveLength(1);
  expect.soft(captured.chordSymbols?.[0]).toMatchObject({
    staffOffset: 0,
    sourcePartOffsets: origins,
    offset: [0, 1],
    measureOffset: 0,
    chordSymbol: { position: { fraction: [0, 1] }, root: { step: "C" } },
  });
  expect.soft(captured.chordSymbols?.[0]?.partOffset ?? 0).toBe(0);
  expect.soft(captured.tracks?.map((track) => track.partOffset)).toEqual([0, 1]);
}

describe("deduplicated global chords retain every visible source part", () => {
  it.each(["show", "auto"] as const)("retains measure-capture origins with second part %s", (visibility) => {
    const score = fixture();
    score.parts[0]!.chordSymbolVisibility = "show";
    score.parts[1]!.chordSymbolVisibility = visibility;
    const before = structuredClone(score);
    const captured = buildClipboardSelection(score, measureSelection());
    expect(captured).not.toBeNull();
    expectSharedChord(captured!, visibility === "show" ? [0, 1] : [0]);
    expect(score).toEqual(before);
  });

  it.each([
    { name: "incidental", chordIds: [] },
    { name: "canonical plus incidental", chordIds: ["m0/chord0"] },
    { name: "rendered plus incidental", chordIds: ["m0/chord0/p0/staff1", "m0/chord0/p1/staff1"] },
    {
      name: "rendered then canonical",
      chordIds: ["m0/chord0/p0/staff1", "m0/chord0/p1/staff1", "m0/chord0"],
    },
    {
      name: "canonical then rendered",
      chordIds: ["m0/chord0", "m0/chord0/p0/staff1", "m0/chord0/p1/staff1"],
    },
  ])("merges all origins for timed $name copies", ({ chordIds }) => {
    const score = fixture();
    score.parts[0]!.chordSymbolVisibility = "show";
    score.parts[1]!.chordSymbolVisibility = "show";
    const before = structuredClone(score);
    const selection = timedSelection([0, 1], 1, chordIds);
    const captured = captureTimedSelection(score, selection, selection.rhythmicRange);
    expect(captured).not.toBeNull();
    expectSharedChord(captured!, [0, 1]);
    expect(score).toEqual(before);
  });

  it.each([
    { name: "incidental", chordIds: [] },
    { name: "canonical", chordIds: ["m0/chord0"] },
  ])("excludes auto-hidden timed origins for $name selection", ({ chordIds }) => {
    const score = fixture();
    const selection = timedSelection([0, 1], 1, chordIds);
    const captured = captureTimedSelection(score, selection, selection.rhythmicRange);
    expect(captured).not.toBeNull();
    expectSharedChord(captured!, [0]);
  });

  it.each(["show", "auto"] as const)("pastes %s source origins onto hidden target parts", (visibility) => {
    const source = fixture();
    source.parts[0]!.chordSymbolVisibility = "show";
    source.parts[1]!.chordSymbolVisibility = visibility;
    const captured = buildClipboardSelection(source, measureSelection())!;
    const target = fixture();
    target.global.measures[0]!.chordSymbols = [];
    target.parts.forEach((part) => {
      part.chordSymbolVisibility = "hide";
    });
    const before = structuredClone(target);
    const result = computePasteResult(
      target,
      { kind: "single", elementType: "event", elementId: noteId(0) },
      pastePayload(captured),
    );
    expect(result).not.toBeNull();
    expect.soft(result!.newScore.global.measures[0]!.chordSymbols).toEqual(source.global.measures[0]!.chordSymbols);
    expect
      .soft(result!.newScore.parts.map((part) => part.chordSymbolVisibility))
      .toEqual(["show", visibility === "show" ? "show" : "hide", "hide"]);
    expect(result!.newScore.parts[2]).toEqual(before.parts[2]);
    expect(target).toEqual(before);
  });
});

describe("canonical chord origins on a view showing only source staff 2", () => {
  it.each([
    { part: 0, chordIds: ["m0/chord0"] },
    { part: 2, chordIds: ["m0/chord0"] },
    { part: 0, chordIds: ["m0/chord0", "m0/chord0/p0/staff2"] },
    { part: 2, chordIds: ["m0/chord0", "m0/chord0/p2/staff2"] },
    { part: 0, chordIds: ["m0/chord0/p0/staff2", "m0/chord0"] },
    { part: 2, chordIds: ["m0/chord0/p2/staff2", "m0/chord0"] },
  ])("matches rendered capture for root part $part and $chordIds", ({ part, chordIds }) => {
    const score = fixture(2);
    useStructuralView(score, part, 2);
    const before = structuredClone(score);
    const rendered = timedSelection([part], 2, [`m0/chord0/p${part}/staff2`]);
    const expected = captureTimedSelection(score, rendered, rendered.rhythmicRange, 1)!;
    const selection = timedSelection([part], 2, chordIds);
    const selectionBefore = structuredClone(selection);
    const actual = captureTimedSelection(score, selection, selection.rhythmicRange, 1);
    expect(actual).not.toBeNull();
    expectSingleSource(actual!, score, part, 2);
    expect.soft(actual!.chordSymbols).toEqual(expected.chordSymbols);
    expect.soft(actual!.tracks).toEqual(expected.tracks);
    expect.soft(buildClipboardSelection(score, selection, 1)).toEqual(actual);
    expect(selection).toEqual(selectionBefore);
    expect(score).toEqual(before);
  });

  it.each([0, 2])("recopies automatic canonical paste selection on root part %i staff 2", (part) => {
    const score = fixture(2);
    useStructuralView(score, part, 2);
    const before = structuredClone(score);
    const sourceSelection = timedSelection([part], 2, [`m0/chord0/p${part}/staff2`]);
    const captured = captureTimedSelection(score, sourceSelection, sourceSelection.rhythmicRange, 1)!;
    const result = computePasteResult(
      score,
      { kind: "single", elementType: "event", elementId: noteId(part, 2, 1) },
      pastePayload(captured),
    );
    expect(result).not.toBeNull();
    expect(result!.selection).toMatchObject({
      kind: "multi",
      elementIds: expect.arrayContaining(["m1/chord0"]),
      rhythmicRange: {
        start: { measureIndex: 1, beat: 0 },
        end: { measureIndex: 1, beat: 4 },
        tracks: [{ partIndex: part, staff: 2, voice: 0 }],
      },
    });
    expect(result!.newScore.global.measures[1]!.chordSymbols).toEqual(score.global.measures[0]!.chordSymbols);
    expect(result!.newScore.parts[part]!.measures[1]!.sequences[0]).toEqual(
      before.parts[part]!.measures[1]!.sequences[0],
    );
    for (const hiddenPart of [0, 1, 2].filter((index) => index !== part)) {
      expect(result!.newScore.parts[hiddenPart]).toEqual(before.parts[hiddenPart]);
    }
    const pastedSelection = result!.selection!;
    const selectionBefore = structuredClone(pastedSelection);
    const recopied = buildClipboardSelection(result!.newScore, pastedSelection, 1);
    expect(recopied).not.toBeNull();
    expect.soft(recopied!.partIndex).toBe(part);
    expect.soft(recopied!.sequenceIndex).toBe(1);
    expect.soft(recopied!.tracks).toMatchObject([{ partOffset: 0, staffOffset: 0, sourceStaff: 2 }]);
    expect.soft(recopied!.chordSymbols).toEqual(captured.chordSymbols);
    expect.soft(recopied!.chordSymbols?.[0]).toMatchObject({ staffOffset: 0, sourcePartOffsets: [0] });
    expect(pastedSelection).toEqual(selectionBefore);
    expect(score).toEqual(before);
  });
});
