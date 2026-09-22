import type { MouseEvent } from "react";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyPatchesToScore, patch, type NoteEvent, type Score } from "@viritura/core";
import { SpatialIndex, type DisplayList } from "@viritura/renderer";
import { buildClipboardSelection } from "../clipboard/buildClipboardSelection";
import { deserializeFragment } from "../clipboard/deserialize";
import { copyToClipboard } from "../commands/clipboardCommands";
import { computeDeleteSelection } from "../commands/computeDeleteSelection";
import { handleCanvasClickImpl, type CanvasHandlerCtx } from "../components/ScoreCanvas/canvasHandlers";
import { buildEditorBindings } from "../keyboard/editorBindings";
import { handleDelete } from "../keyboard/normalModeDelete";
import { handleArrowUpDown } from "../keyboard/normalModeHandlers";
import type { KeyboardHandlerContext } from "../keyboard/types";
import { buildNavigationIndex, getEntry } from "../navigation/NavigationIndex";
import { createHistoryStore } from "../store/historyStore";
import {
  selectionReducer,
  useSelectionActions,
  useSelectionStore,
  type MeasureSelectionPoint,
  type Selection,
} from "../store/selectionStore";
import { resolveSelectionEvents } from "../store/selectionUtils";

function note(id: string): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base: "quarter" },
    notes: [{ id: `${id}-pitch`, pitch: { step: "C", octave: 4 } }],
  };
}

function fixture(secondaryStaff = false): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          id: "measure-0",
          time: { count: 4, unit: 4 },
          chordSymbols: [
            { position: { fraction: [0, 1] }, root: { step: "C" }, quality: "major" },
            { position: { fraction: [1, 2] }, root: { step: "G" }, quality: "dominant" },
          ],
        },
      ],
    },
    parts: Array.from({ length: 3 }, (_, partIndex) => ({
      id: `part-${partIndex}`,
      name: `Instrument ${partIndex + 1}`,
      staves: secondaryStaff && partIndex === 2 ? 2 : 1,
      measures: [
        {
          sequences: Array.from({ length: secondaryStaff && partIndex === 2 ? 2 : 1 }, (_, sequenceIndex) => ({
            staff: sequenceIndex + 1,
            content: [note(`note-${partIndex}-${sequenceIndex}`), note(`outside-${partIndex}-${sequenceIndex}`)],
          })),
        },
      ],
    })),
  };
}

function noteId(partIndex = 2, sequenceIndex = 0): string {
  return `p${partIndex}/m0/s${sequenceIndex}/note-${partIndex}-${sequenceIndex}/n0`;
}

function clickRange(
  chordId: string,
  endpoint: string,
  anchor?: MeasureSelectionPoint,
  reverse = false,
  focus?: MeasureSelectionPoint,
): Selection {
  const single = selectionReducer(
    { kind: "none" },
    { type: "SELECT_ELEMENT", elementId: reverse ? endpoint : chordId, measureAnchor: anchor },
  );
  const range = selectionReducer(single, {
    type: "EXTEND_SELECTION",
    elementId: reverse ? chordId : endpoint,
    measureAnchor: focus,
  });
  expect(range).toEqual({
    kind: "range",
    startElementId: reverse ? endpoint : chordId,
    endElementId: reverse ? chordId : endpoint,
    ...(anchor && { measureAnchor: anchor }),
    ...(focus && { measureFocus: focus }),
  });
  return range;
}

function keyboardContext(score: Score, initialSelection: Selection) {
  let current = score;
  let selection = initialSelection;
  const history = createHistoryStore(JSON.stringify(score), {
    current: (json) => {
      current = JSON.parse(json) as Score;
    },
  });
  const updateScore = vi.fn((next: Score) => {
    current = next;
    history.getState().pushState(JSON.stringify(current), "Delete range");
  });
  const commitPatches = vi.fn<KeyboardHandlerContext["commitPatches"]>((patches) => {
    current = applyPatchesToScore(current, patches);
    history.getState().pushState(JSON.stringify(current), "Transpose range");
  });
  const clearSelection = vi.fn(() => {
    selection = selectionReducer(selection, { type: "CLEAR_SELECTION" });
  });
  const ctx = {
    getScore: () => current,
    getSelection: () => selection,
    getConfig: () => ({ selectedScoreIndex: 0 }),
    getNavIndex: () => buildNavigationIndex(current),
    commitPatches,
    updateScore,
    clearSelection,
    previewPitch: vi.fn(),
  } as unknown as KeyboardHandlerContext;
  return { ctx, current: () => current, history, commitPatches, updateScore, clearSelection };
}

function transpose(harness: ReturnType<typeof keyboardContext>): void {
  const event = new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, cancelable: true });
  handleArrowUpDown(event, false, harness.ctx);
  expect(event.defaultPrevented).toBe(true);
}

function expectedPatch(partIndex = 2, sequenceIndex = 0) {
  return patch.setNotePitch(
    {
      sequencePath: { partId: `part-${partIndex}`, measureIndex: 0, voice: sequenceIndex },
      eventId: `note-${partIndex}-${sequenceIndex}`,
    },
    `note-${partIndex}-${sequenceIndex}-pitch`,
    { step: "D", octave: 4 },
  );
}

function eventAt(score: Score, partIndex = 2, sequenceIndex = 0, eventIndex = 0): NoteEvent {
  return score.parts[partIndex]!.measures[0]!.sequences[sequenceIndex]!.content[eventIndex] as NoteEvent;
}

function expectOnlySourceDeleted(next: Score, original: Score, sequenceIndex: number): void {
  expect(next.global).toEqual(original.global);
  expect(next.parts.slice(0, 2)).toEqual(original.parts.slice(0, 2));
  expect(eventAt(next, 2, sequenceIndex).rest).toBeDefined();
  expect(eventAt(next, 2, sequenceIndex).notes).toBeUndefined();
  expect(eventAt(next, 2, sequenceIndex, 1)).toEqual(eventAt(original, 2, sequenceIndex, 1));
  if (sequenceIndex === 1) {
    expect(next.parts[2]!.measures[0]!.sequences[0]).toEqual(original.parts[2]!.measures[0]!.sequences[0]);
  }
}

interface RangeCase {
  layout: "ordinary" | "reordered" | "condensed-neighbours" | "secondary";
  rendered: boolean;
  reverse: boolean;
}

const cases: RangeCase[] = (["ordinary", "reordered", "condensed-neighbours", "secondary"] as const).flatMap((layout) =>
  [false, true].flatMap((rendered) => [false, true].map((reverse) => ({ layout, rendered, reverse }))),
);

function rangeFixture({ layout, rendered, reverse }: RangeCase) {
  const sequenceIndex = layout === "secondary" ? 1 : 0;
  const score = fixture(sequenceIndex === 1);
  if (layout !== "ordinary") {
    const sources =
      layout === "condensed-neighbours"
        ? [
            { type: "staff" as const, sources: [{ part: "part-0" }, { part: "part-1" }] },
            { type: "staff" as const, sources: [{ part: "part-2" }] },
          ]
        : [
            { type: "staff" as const, sources: [{ part: "part-2", staff: sequenceIndex + 1 }] },
            { type: "staff" as const, sources: [{ part: "part-0" }] },
            { type: "staff" as const, sources: [{ part: "part-1" }] },
          ];
    score.layouts = [{ id: "structural", content: sources }];
    score.scores = [{ layout: "structural" }];
  }
  const anchor: MeasureSelectionPoint = {
    partIndex: 2,
    staffIndex: layout === "ordinary" ? 2 : layout === "condensed-neighbours" ? 1 : 0,
    localStaffIndex: 0,
    measureIndex: 0,
  };
  // Both suffix indices identify the display copy, not part-2's source staff.
  const chordId = rendered ? `m0/chord0/p${anchor.staffIndex}/staff${anchor.staffIndex}` : "m0/chord0";
  return { score, sequenceIndex, selection: clickRange(chordId, noteId(2, sequenceIndex), anchor, reverse, anchor) };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useSelectionStore.setState(useSelectionStore.getInitialState());
});

describe("global chord RANGE above the third source instrument", () => {
  it.each(cases)(
    "keyboard transpose commits only source pitches and undoes atomically: $layout rendered=$rendered reverse=$reverse",
    (testCase) => {
      const { score, selection, sequenceIndex } = rangeFixture(testCase);
      const before = structuredClone(score);
      const harness = keyboardContext(score, selection);

      transpose(harness);

      expect(harness.commitPatches).toHaveBeenCalledExactlyOnceWith([expectedPatch(2, sequenceIndex)]);
      expect(harness.updateScore).not.toHaveBeenCalled();
      const expected = structuredClone(before);
      eventAt(expected, 2, sequenceIndex).notes![0]!.pitch = { step: "D", octave: 4 };
      expect(harness.current()).toEqual(expected);
      expect(score).toEqual(before);
      expect(harness.ctx.getSelection()).toEqual(selection);
      expect(harness.current().global).toEqual(before.global);
      expect(getEntry(buildNavigationIndex(harness.current()), "m0/chord0")?.partIndex).toBe(-1);
      expect(harness.history.getState().historySize).toBe(2);
      expect(harness.history.getState().undo()).toBe(JSON.stringify(before));
      expect(harness.current()).toEqual(before);
      expect(harness.history.getState().canUndo).toBe(false);
      harness.history.getState().redo();
      expect(harness.current()).toEqual(expected);
    },
  );

  it.each(cases)(
    "computeDeleteSelection blanks only the selected source: $layout rendered=$rendered reverse=$reverse",
    (testCase) => {
      const { score, selection, sequenceIndex } = rangeFixture(testCase);
      const before = structuredClone(score);
      const result = computeDeleteSelection(structuredClone(score), selection);

      expect(result.kind).toBe("multi");
      if (result.kind !== "multi") throw new Error("Expected an event-range deletion");
      expectOnlySourceDeleted(result.score, before, sequenceIndex);
      expect(result.nextSelection).toEqual({ kind: "clear" });
      expect(score).toEqual(before);
    },
  );

  it.each(cases)(
    "keyboard Delete commits the source edit and supports undo: $layout rendered=$rendered reverse=$reverse",
    (testCase) => {
      const { score, selection, sequenceIndex } = rangeFixture(testCase);
      const before = structuredClone(score);
      const harness = keyboardContext(score, selection);
      const event = new KeyboardEvent("keydown", { key: "Delete", cancelable: true });

      handleDelete(event, false, harness.ctx);

      expect(event.defaultPrevented).toBe(true);
      expect(harness.updateScore).toHaveBeenCalledTimes(1);
      expectOnlySourceDeleted(harness.current(), before, sequenceIndex);
      expect(harness.clearSelection).toHaveBeenCalledTimes(1);
      expect(harness.ctx.getSelection()).toEqual({ kind: "none" });
      expect(harness.history.getState().historySize).toBe(2);
      harness.history.getState().undo();
      expect(harness.current()).toEqual(before);
      expect(score).toEqual(before);
    },
  );

  it.each(cases)(
    "buildClipboardSelection and copy retain only source music: $layout rendered=$rendered reverse=$reverse",
    async (testCase) => {
      const { score, selection, sequenceIndex } = rangeFixture(testCase);
      const before = structuredClone(score);
      const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
      vi.stubGlobal("navigator", { clipboard: { writeText } });

      const captured = buildClipboardSelection(score, selection, 0);

      expect(captured).not.toBeNull();
      expect(captured).toMatchObject({
        partIndex: 2,
        sequenceIndex,
        captureOrigin: { measureIndex: 0, beat: 0 },
        events: [eventAt(before, 2, sequenceIndex)],
      });
      expect(captured!.cutLocations).toEqual([{ partIndex: 2, measureIndex: 0, sequenceIndex, eventIndex: 0 }]);
      expect(captured!.chordSymbols).toHaveLength(1);
      expect(captured!.chordSymbols![0]).toMatchObject({
        staffOffset: 0,
        sourcePartOffsets: [0],
        chordSymbol: before.global.measures[0]!.chordSymbols![0],
      });
      // A single source track without a lead-in is serialized in `events`.
      expect(captured!.tracks).toBeUndefined();
      await expect(copyToClipboard(captured!)).resolves.toBe(true);
      expect(writeText).toHaveBeenCalledTimes(1);
      const fragment = deserializeFragment(writeText.mock.calls[0]![0]);
      expect(fragment).not.toBeNull();
      expect(fragment!.content).toEqual([eventAt(before, 2, sequenceIndex)]);
      expect(fragment!.tracks).toEqual(captured!.tracks);
      expect(fragment!.chordSymbols).toEqual(captured!.chordSymbols);
      expect(score).toEqual(before);
    },
  );
});

describe("global chord source fallback and annotation identity", () => {
  it.each<Selection>([{ kind: "none" }, { kind: "multi", elementIds: [noteId(0), noteId(1)] }])(
    "preserves source context when Shift-click starts from $kind",
    (initial) => {
      const score = fixture();
      const anchor = { partIndex: 2, staffIndex: 0, localStaffIndex: 0, sourceStaff: 1, measureIndex: 0 };
      const single = selectionReducer(initial, {
        type: "EXTEND_SELECTION",
        elementId: "m0/chord0/p0/staff0",
        measureAnchor: anchor,
      });
      expect(single).toMatchObject({ kind: "single", measureAnchor: anchor });
      const range = selectionReducer(single, { type: "EXTEND_SELECTION", elementId: noteId(0) });
      expect(resolveSelectionEvents(range, score).map((location) => location.partIndex)).toEqual([0, 1, 2]);
    },
  );
  it.each([
    {
      name: "canonical source anchor on a reordered primary staff",
      start: "m0/chord0",
      end: "m0/chord1",
      sequenceIndex: 0,
      anchor: { partIndex: 2, staffIndex: 0, localStaffIndex: 0, measureIndex: 0 },
    },
    {
      name: "canonical source anchor on a displayed primary but source secondary staff",
      start: "m0/chord0",
      end: "m0/chord1",
      sequenceIndex: 1,
      anchor: { partIndex: 2, staffIndex: 0, localStaffIndex: 1, measureIndex: 0 },
    },
    {
      name: "rendered display copy with a source anchor",
      start: "m0/chord0/p0/staff8",
      end: "m0/chord1/p0/staff8",
      sequenceIndex: 1,
      anchor: { partIndex: 2, staffIndex: 7, localStaffIndex: 1, measureIndex: 0 },
    },
  ])("resolves chord-to-chord ranges using $name", ({ start, end, sequenceIndex, anchor }) => {
    const score = fixture(true);
    const before = structuredClone(score);
    const selection = clickRange(start, end, anchor);
    const harness = keyboardContext(score, selection);

    expect(resolveSelectionEvents(selection, score)).toEqual([
      { partIndex: 2, measureIndex: 0, sequenceIndex, eventIndex: 0 },
      { partIndex: 2, measureIndex: 0, sequenceIndex, eventIndex: 1 },
    ]);
    transpose(harness);

    const outsideId = `outside-2-${sequenceIndex}`;
    expect(harness.commitPatches).toHaveBeenCalledExactlyOnceWith([
      expectedPatch(2, sequenceIndex),
      patch.setNotePitch(
        { sequencePath: { partId: "part-2", measureIndex: 0, voice: sequenceIndex }, eventId: outsideId },
        `${outsideId}-pitch`,
        { step: "D", octave: 4 },
      ),
    ]);
    expect(buildClipboardSelection(score, selection)?.events).toEqual(
      before.parts[2]!.measures[0]!.sequences[sequenceIndex]!.content,
    );
    expect(harness.current().global).toEqual(before.global);
    harness.history.getState().undo();
    expect(harness.current()).toEqual(before);
    expect(score).toEqual(before);

    const deleted = structuredClone(before);
    deleted.parts[2]!.measures[0]!.sequences[sequenceIndex]!.content = [];
    deleted.parts[2]!.measures[0]!.sequences[sequenceIndex]!.fullMeasure = { visualDuration: { base: "whole" } };
    const computed = computeDeleteSelection(structuredClone(score), selection);
    expect(computed).toMatchObject({ kind: "multi", score: deleted, nextSelection: { kind: "clear" } });
    const deletion = keyboardContext(score, selection);
    handleDelete(new KeyboardEvent("keydown", { key: "Delete" }), false, deletion.ctx);
    expect(deletion.updateScore).toHaveBeenCalledExactlyOnceWith(deleted);
    expect(deletion.current().global).toEqual(before.global);
    deletion.history.getState().undo();
    expect(deletion.current()).toEqual(before);
  });

  it("uses source bounds rather than treating rendered copy indices as source coordinates", () => {
    const score = fixture(true);
    const selection = clickRange("m0/chord0/p0/staff8", noteId(2, 1), {
      partIndex: 2,
      staffIndex: 7,
      localStaffIndex: 1,
      measureIndex: 0,
    });
    const harness = keyboardContext(score, selection);

    transpose(harness);

    expect(harness.commitPatches).toHaveBeenCalledExactlyOnceWith([expectedPatch(2, 1)]);
    expect(buildClipboardSelection(score, selection)?.events).toEqual([eventAt(score, 2, 1)]);
  });

  it.each([
    { reverse: false, chordId: "m0/chord0" },
    { reverse: true, chordId: "m0/chord0" },
    { reverse: false, chordId: "m0/chord0/p0/staff0" },
    { reverse: true, chordId: "m0/chord0/p0/staff0" },
  ])("uses the other physical endpoint, not $chordId's suffix (reverse=$reverse)", ({ reverse, chordId }) => {
    const score = fixture(true);
    const selection = clickRange(chordId, noteId(2, 1), undefined, reverse);
    const harness = keyboardContext(score, selection);

    transpose(harness);

    expect(harness.commitPatches).toHaveBeenCalledExactlyOnceWith([expectedPatch(2, 1)]);
    expect(buildClipboardSelection(score, selection)?.events).toEqual([eventAt(score, 2, 1)]);
  });

  it.each([
    { name: "canonical chords without context", chordId: "m0/chord0" },
    { name: "valid-looking display suffix without context", chordId: "m0/chord0/p0/staff1" },
    { name: "out-of-range display suffix without context", chordId: "m0/chord0/p99/staff1" },
    {
      name: "invalid source part despite a physical endpoint",
      chordId: "m0/chord0/p0/staff1",
      anchor: { partIndex: 99, staffIndex: 0, localStaffIndex: 0, measureIndex: 0 },
      endpoint: noteId(),
    },
    {
      name: "invalid source staff despite a physical endpoint",
      chordId: "m0/chord0/p0/staff1",
      anchor: { partIndex: 2, staffIndex: 0, localStaffIndex: 2, measureIndex: 0 },
      endpoint: noteId(),
    },
    {
      name: "ambiguous multistaff source with only a display row",
      chordId: "m0/chord0/p0/staff1",
      anchor: { partIndex: 2, staffIndex: 1, measureIndex: 0 },
    },
    {
      name: "invalid focus overrides the starting note's source",
      chordId: "m0/chord0/p0/staff1",
      anchor: { partIndex: 2, staffIndex: 0, localStaffIndex: 0, measureIndex: 0 },
      focus: { partIndex: 2, staffIndex: 0, localStaffIndex: -1, measureIndex: 0 },
      endpoint: noteId(),
      reverse: true,
    },
  ])("fails closed: $name", ({ chordId, anchor, focus, endpoint, reverse }) => {
    const score = fixture(true);
    const before = structuredClone(score);
    const selection = clickRange(chordId, endpoint ?? "m0/chord1", anchor, reverse, focus);
    const harness = keyboardContext(score, selection);

    expect(resolveSelectionEvents(selection, score)).toEqual([]);
    transpose(harness);

    expect(harness.commitPatches).not.toHaveBeenCalled();
    expect(computeDeleteSelection(structuredClone(score), selection)).toEqual({ kind: "noop" });
    handleDelete(new KeyboardEvent("keydown", { key: "Delete" }), false, harness.ctx);
    expect(harness.updateScore).not.toHaveBeenCalled();
    expect(harness.history.getState().canUndo).toBe(false);
    expect(buildClipboardSelection(score, selection)).toBeNull();
    expect(score).toEqual(before);
  });

  it.each(["m0/chord0", "m0/chord0/p2/staff1"])(
    "keeps standalone %s global rather than turning it into a part annotation",
    (elementId) => {
      const score = fixture();
      const before = structuredClone(score);
      const selection = selectionReducer(
        { kind: "none" },
        {
          type: "SELECT_ELEMENT",
          elementId,
          measureAnchor: { partIndex: 2, staffIndex: 0, localStaffIndex: 0, measureIndex: 0 },
        },
      );

      expect(getEntry(buildNavigationIndex(score), elementId)).toMatchObject({
        elementId: "m0/chord0",
        partIndex: -1,
      });
      expect(resolveSelectionEvents(selection, score)).toEqual([]);
      const result = computeDeleteSelection(score, selection);
      expect(result.kind).toBe("single");
      if (result.kind !== "single") throw new Error("Expected global annotation deletion");
      expect(result.score.parts).toEqual(before.parts);
      expect(result.score.global.measures[0]!.chordSymbols).toEqual([before.global.measures[0]!.chordSymbols![1]]);
      expect(score).toEqual(before);
    },
  );
});

describe("chord range focus and rhythmic bounds", () => {
  it.each(["m0/chord1", "m0/chord1/p0/staff0"])(
    "uses the ending chord's measureFocus, not the starting note's source: %s",
    (chordId) => {
      const { score } = rangeFixture({ layout: "secondary", rendered: true, reverse: false });
      const before = structuredClone(score);
      const anchor = { partIndex: 1, staffIndex: 2, localStaffIndex: 0, measureIndex: 0 };
      const focus = { partIndex: 2, staffIndex: 0, localStaffIndex: 0, measureIndex: 0 };
      const selection = clickRange(chordId, noteId(1), anchor, true, focus);
      const sources = [
        { partIndex: 1, sequenceIndex: 0, staffOffset: 0 },
        { partIndex: 2, sequenceIndex: 0, staffOffset: 1 },
        { partIndex: 2, sequenceIndex: 1, staffOffset: 2 },
      ];
      const locations = sources.flatMap(({ partIndex, sequenceIndex }) =>
        [0, 1].map((eventIndex) => ({ partIndex, sequenceIndex, measureIndex: 0, eventIndex })),
      );
      expect(resolveSelectionEvents(selection, score)).toEqual(locations);
      const captured = buildClipboardSelection(score, selection, 0);
      expect(captured!.tracks).toHaveLength(3);
      expect(captured!.tracks).toMatchObject(
        sources.map(({ partIndex, sequenceIndex, staffOffset }) => ({
          partOffset: partIndex - 1,
          staffOffset,
          sourceStaff: sequenceIndex + 1,
          voiceIndex: 0,
          content: before.parts[partIndex]!.measures[0]!.sequences[sequenceIndex]!.content,
        })),
      );
      expect(captured!.cutLocations).toHaveLength(locations.length);
      expect(captured!.cutLocations).toEqual(expect.arrayContaining(locations));
      expect(captured!.chordSymbols!.filter((chord) => chord.chordSymbol.root?.step === "G")).toEqual([
        expect.objectContaining({
          staffOffset: 2,
          sourcePartOffsets: [1],
          chordSymbol: before.global.measures[0]!.chordSymbols![1],
        }),
      ]);

      const transposed = structuredClone(before);
      const deleted = structuredClone(before);
      for (const { partIndex, sequenceIndex, eventIndex } of locations) {
        eventAt(transposed, partIndex, sequenceIndex, eventIndex).notes![0]!.pitch = { step: "D", octave: 4 };
      }
      for (const { partIndex, sequenceIndex } of sources) {
        const sequence = deleted.parts[partIndex]!.measures[0]!.sequences[sequenceIndex]!;
        sequence.content = [];
        sequence.fullMeasure = { visualDuration: { base: "whole" } };
      }
      const harness = keyboardContext(score, selection);
      transpose(harness);
      expect(harness.current()).toEqual(transposed);
      expect(harness.current().global).toEqual(before.global);
      const computed = computeDeleteSelection(structuredClone(score), selection);
      expect(computed).toMatchObject({ kind: "multi", score: deleted });
      const deletion = keyboardContext(score, selection);
      handleDelete(new KeyboardEvent("keydown", { key: "Delete" }), false, deletion.ctx);
      expect(deletion.updateScore).toHaveBeenCalledExactlyOnceWith(deleted);
      expect(deletion.current().global).toEqual(before.global);
      expect(score).toEqual(before);
    },
  );

  it.each([false, true])("clips both ends of a cross-measure range (reverse=%s)", (reverse) => {
    const score = fixture(true);
    score.global.measures = [0, 1].map((measureIndex) => ({
      id: `measure-${measureIndex}`,
      time: { count: 4, unit: 4 },
      chordSymbols: [{ position: { fraction: [1, 4] }, root: { step: "G" } }],
    }));
    for (const [partIndex, part] of score.parts.entries()) {
      part.measures = [0, 1].map((measureIndex) => ({
        sequences: Array.from({ length: part.staves ?? 1 }, (_, sequenceIndex) => ({
          staff: sequenceIndex + 1,
          content: [0, 1, 2, 3].map((beat) => note(`p${partIndex}-s${sequenceIndex}-m${measureIndex}-b${beat}`)),
        })),
      }));
    }
    const before = structuredClone(score);
    const source = { partIndex: 2, staffIndex: 0, localStaffIndex: 1 };
    const selection = clickRange(
      "m0/chord0/p0/staff0",
      "m1/chord0/p0/staff0",
      { ...source, measureIndex: reverse ? 1 : 0 },
      reverse,
      { ...source, measureIndex: reverse ? 0 : 1 },
    );
    const locations = [
      ...[1, 2, 3].map((eventIndex) => ({ partIndex: 2, sequenceIndex: 1, measureIndex: 0, eventIndex })),
      ...[0, 1].map((eventIndex) => ({ partIndex: 2, sequenceIndex: 1, measureIndex: 1, eventIndex })),
    ];
    expect(resolveSelectionEvents(selection, score)).toEqual(locations);
    const events = locations.map(
      ({ measureIndex, eventIndex }) => score.parts[2]!.measures[measureIndex]!.sequences[1]!.content[eventIndex]!,
    );
    const captured = buildClipboardSelection(score, selection);
    expect(captured).toMatchObject({
      captureOrigin: { measureIndex: 0, beat: 1 },
      events,
      cutLocations: locations,
      chordSymbols: [
        { measureOffset: 0, offset: [0, 1], staffOffset: 0, sourcePartOffsets: [0] },
        { measureOffset: 1, offset: [1, 1], staffOffset: 0, sourcePartOffsets: [0] },
      ],
    });
    expect(captured!.tracks).toBeUndefined();

    const transposed = structuredClone(before);
    const deleted = structuredClone(before);
    for (const { measureIndex, eventIndex } of locations) {
      const pitchEvent = transposed.parts[2]!.measures[measureIndex]!.sequences[1]!.content[eventIndex] as NoteEvent;
      pitchEvent.notes![0]!.pitch = { step: "D", octave: 4 };
    }
    // Generated 4/4 rests expose the half-bar while combining aligned spans.
    const rest = (base: "quarter" | "half"): NoteEvent => ({
      type: "event",
      id: expect.any(String),
      duration: { base },
      rest: {},
    });
    deleted.parts[2]!.measures[0]!.sequences[1]!.content.splice(1, 3, rest("quarter"), rest("half"));
    deleted.parts[2]!.measures[1]!.sequences[1]!.content.splice(0, 2, rest("half"));
    const harness = keyboardContext(score, selection);
    transpose(harness);
    expect(harness.current()).toEqual(transposed);
    expect(harness.current().global).toEqual(before.global);
    expect(computeDeleteSelection(structuredClone(score), selection)).toEqual({
      kind: "multi",
      score: deleted,
      nextSelection: { kind: "clear" },
    });
    const deletion = keyboardContext(score, selection);
    handleDelete(new KeyboardEvent("keydown", { key: "Delete" }), false, deletion.ctx);
    expect(deletion.updateScore).toHaveBeenCalledExactlyOnceWith(deleted);
    expect(deletion.current().global).toEqual(before.global);
    expect(deletion.commitPatches).not.toHaveBeenCalled();
    expect(deletion.clearSelection).toHaveBeenCalledTimes(1);
    expect(deletion.ctx.getSelection()).toEqual({ kind: "none" });
    const deletedSnapshot = structuredClone(deletion.current());
    expect(deletion.history.getState().historySize).toBe(2);
    expect(deletion.history.getState().undo()).toBe(JSON.stringify(before));
    expect(deletion.current()).toEqual(before);
    expect(deletion.history.getState().canUndo).toBe(false);
    deletion.history.getState().redo();
    expect(deletion.current()).toEqual(deletedSnapshot);
    expect(score).toEqual(before);
  });

  it.each([false, true].flatMap((reverse) => [false, true].map((secondary) => ({ reverse, secondary }))))(
    "canvas click → shift-click retains source context (reverse=$reverse secondary=$secondary)",
    ({ reverse, secondary }) => {
      const { score } = rangeFixture({ layout: secondary ? "secondary" : "reordered", rendered: true, reverse: false });
      // Exercise a non-default view so source context must survive the pointer.
      score.scores!.unshift({});
      const targetId = secondary ? noteId(2, 1) : noteId(1);
      const noteY = secondary ? 70 : 270;
      const { result: actions } = renderHook(() => useSelectionActions());
      const chordId = "m0/chord0/p0/staff0";
      const list: DisplayList = {
        width: 800,
        height: 600,
        commands: [],
        measureBounds: [2, 0, 1].map((partIndex, staffIndex) => ({
          index: 0,
          partIndex,
          staffIndex,
          x: 0,
          y: 50 + staffIndex * 100,
          width: 400,
          height: 40,
          prefixWidth: 0,
          totalBeats: 4,
          beatAnchors: [],
        })),
      };
      useSelectionStore.setState({
        renderedStaffSources: [2, 0, 1].map((partIndex, staffIndex) => ({
          measureIndex: 0,
          staffIndex,
          partIds: [`part-${partIndex}`],
        })),
      });
      const ctx = {
        viewport: { zoom: 1, scrollX: 0, scrollY: 0 },
        viewMode: "horizon",
        selectedScoreIndex: 1,
        selectedIds: new Set<string>(),
        canvasRef: { current: document.createElement("canvas") },
        spatialIndexRef: {
          current: new SpatialIndex([
            { id: chordId, x: 100, y: 20, width: 60, height: 20 },
            { id: targetId, x: 100, y: noteY - 10, width: 20, height: 20 },
          ]),
        },
        displayListRef: { current: list },
        dragOccurredRef: { current: false },
        spannerDragRef: { current: null },
        interactionModeRef: { current: "write" },
        selectedSlurIdRef: { current: null },
        docScoreRef: { current: score },
        pageSetupRef: { current: { margins: { left: 0 } } },
        engraveAdornmentsRef: { current: undefined },
        previewChord: vi.fn().mockResolvedValue(undefined),
        selectElement: actions.current.selectElement,
        extendSelection: actions.current.extendSelection,
        clearSelection: actions.current.clearSelection,
      } as unknown as CanvasHandlerCtx;
      handleCanvasClickImpl({ clientX: 110, clientY: reverse ? noteY : 30 } as MouseEvent<HTMLCanvasElement>, ctx);
      handleCanvasClickImpl(
        { clientX: 110, clientY: reverse ? 30 : noteY, shiftKey: true } as MouseEvent<HTMLCanvasElement>,
        ctx,
      );
      const selection = useSelectionStore.getState().selection;
      expect(selection).toMatchObject({
        kind: "range",
        startElementId: reverse ? targetId : chordId,
        endElementId: reverse ? chordId : targetId,
        measureAnchor: { partIndex: reverse && !secondary ? 1 : 2, localStaffIndex: 0 },
        measureFocus: { partIndex: !reverse && !secondary ? 1 : 2, localStaffIndex: 0 },
      });
      if (selection.kind !== "range") throw new Error("Expected pointer range");
      expect((reverse ? selection.measureFocus : selection.measureAnchor)?.sourceStaff).toBe(secondary ? 2 : 1);
      const harness = keyboardContext(score, selection);
      transpose(harness);
      expect(harness.commitPatches).toHaveBeenCalledExactlyOnceWith(
        secondary ? [expectedPatch(2, 1)] : [expectedPatch(1), expectedPatch(2)],
      );
      expect(harness.current().global).toEqual(score.global);
      harness.history.getState().undo();
      expect(harness.current()).toEqual(score);
      if (secondary) {
        const captured = buildClipboardSelection(score, selection, 1)!;
        expect(captured.events).toEqual([eventAt(score, 2, 1)]);
        expect(captured.chordSymbols?.[0]).toMatchObject({ staffOffset: 0, sourcePartOffsets: [0] });
        const deletion = keyboardContext(score, selection);
        handleDelete(new KeyboardEvent("keydown", { key: "Delete" }), false, deletion.ctx);
        expectOnlySourceDeleted(deletion.current(), score, 1);
      }
    },
  );
});

describe("condensed chord ranges retain downstream writeback policy", () => {
  it.each([false, true])(
    "broadcasts only to merged sources, unless on an expansion (isExpansion=%s)",
    (isExpansion) => {
      const score = fixture();
      score.layouts = [
        {
          id: "merged",
          content: [
            { type: "staff", sources: [{ part: "part-1" }, { part: "part-2" }] },
            { type: "staff", sources: [{ part: "part-0" }] },
          ],
        },
      ];
      score.scores = [{ layout: "merged" }];
      const before = structuredClone(score);
      const selection = clickRange(isExpansion ? "m0/chord0/p2/staff2" : "m0/chord0/p0/staff0", noteId(), {
        partIndex: 2,
        staffIndex: isExpansion ? 2 : 0,
        localStaffIndex: 0,
        measureIndex: 0,
        isExpansion,
      });
      expect(resolveSelectionEvents(selection, score)).toEqual([
        { partIndex: 2, measureIndex: 0, sequenceIndex: 0, eventIndex: 0 },
      ]);
      const harness = keyboardContext(score, selection);

      transpose(harness);

      const parts = isExpansion ? [2] : [1, 2];
      expect(harness.commitPatches).toHaveBeenCalledTimes(1);
      expect(harness.commitPatches.mock.calls[0]![0]).toEqual(parts.map((partIndex) => expectedPatch(partIndex)));
      const captured = buildClipboardSelection(score, selection, 0);
      expect(captured!.chordSymbols).toEqual([
        expect.objectContaining({
          staffOffset: 0,
          sourcePartOffsets: isExpansion ? [0] : [0, 1],
          chordSymbol: before.global.measures[0]!.chordSymbols![0],
        }),
      ]);
      if (isExpansion) {
        expect(captured!.tracks).toBeUndefined();
        expect(captured!.events).toEqual([eventAt(before, 2)]);
      } else {
        expect(captured!.tracks).toHaveLength(2);
        expect(captured!.tracks).toMatchObject(
          parts.map((partIndex) => ({
            partOffset: partIndex - 1,
            staffOffset: partIndex - 1,
            sourceStaff: 1,
            voiceIndex: 0,
            content: [eventAt(before, partIndex)],
          })),
        );
      }
      const expected = structuredClone(before);
      for (const partIndex of parts) eventAt(expected, partIndex).notes![0]!.pitch = { step: "D", octave: 4 };
      expect(harness.current()).toEqual(expected);
      harness.history.getState().undo();
      expect(harness.current()).toEqual(before);
      expect(score).toEqual(before);
    },
  );
});

function bindingHarness(score: Score, selection: Selection) {
  const harness = keyboardContext(score, selection);
  useSelectionStore.setState({ selection });
  const { result } = renderHook(() => useSelectionActions());
  const selectElement = vi.fn(result.current.selectElement);
  const extendSelection = vi.fn(result.current.extendSelection);
  const ctx: KeyboardHandlerContext = {
    ...harness.ctx,
    getSelection: () => useSelectionStore.getState().selection,
    selectElement,
    extendSelection,
    clearSelection: result.current.clearSelection,
  };
  const bindings = buildEditorBindings({
    ctx,
    canvasRef: { current: null },
    getCurrentZoom: () => 1,
    appCallbacks: {
      onShowHelp: vi.fn(),
      onOpenFile: vi.fn(),
      onSave: vi.fn(),
      onSaveAs: vi.fn(),
      onCopy: vi.fn(),
      onCut: vi.fn(),
      onPaste: vi.fn(),
    },
    selectAll: vi.fn(),
    setVoice: vi.fn(),
    toggleNoteInput: vi.fn(),
    selectElement,
    clearSelection: ctx.clearSelection,
    undo: vi.fn(),
    redo: vi.fn(),
    setAccidental: vi.fn(),
  });
  const press = (combo: string) => {
    const binding = bindings.find((candidate) => candidate.context === "normal" && candidate.key === combo);
    expect(binding, `normal-mode binding for ${combo}`).toBeDefined();
    const event = new KeyboardEvent("keydown", {
      key: combo.split("+").at(-1),
      shiftKey: combo.includes("Shift+"),
      altKey: combo.includes("Alt+"),
      cancelable: true,
    });
    binding!.handler(event);
  };
  return { ...harness, ctx, press, selectElement, extendSelection };
}

type ArrowLayout = "ordinary" | "reordered" | "condensed-neighbours" | "secondary";

function arrowFixture(layout: ArrowLayout = "ordinary", sourceCount = 4) {
  const score = fixture(layout === "secondary");
  if (sourceCount === 4) {
    score.parts.push({
      id: "part-3",
      name: "Instrument 4",
      staves: 1,
      measures: [{ sequences: [{ staff: 1, content: [note("note-3-0"), note("outside-3-0")] }] }],
    });
  }
  if (layout !== "ordinary") {
    const content =
      layout === "condensed-neighbours"
        ? [
            { type: "staff" as const, sources: [{ part: "part-0" }, { part: "part-1" }] },
            { type: "staff" as const, sources: [{ part: "part-2" }] },
            { type: "staff" as const, sources: [{ part: "part-3" }] },
          ]
        : [2, 0, 3, 1].map((partIndex) => ({
            type: "staff" as const,
            sources: [{ part: `part-${partIndex}`, staff: layout === "secondary" && partIndex === 2 ? 2 : 1 }],
          }));
    score.layouts = [{ id: "arrow-layout", content }];
    score.scores = [{ layout: "arrow-layout" }];
  }
  // Decoys ensure an unanchored Alt+Arrow cannot silently choose part 0 or a copy suffix.
  for (const [partIndex, part] of score.parts.entries()) {
    part.measures[0]!.dynamics = [
      { id: `source-${partIndex}`, type: "immediate", position: { fraction: [0, 1] }, value: "p" },
    ];
  }
  return score;
}

function arrowAnchor(partIndex: number, layout: ArrowLayout = "ordinary"): MeasureSelectionPoint {
  return {
    partIndex,
    staffIndex: layout === "ordinary" ? partIndex : layout === "condensed-neighbours" ? 1 : 0,
    localStaffIndex: 0,
    sourceStaff: layout === "secondary" ? 2 : 1,
    measureIndex: 0,
  };
}

function chordSingle(elementId: string, measureAnchor?: MeasureSelectionPoint): Selection {
  return selectionReducer({ kind: "none" }, { type: "SELECT_ELEMENT", elementId, measureAnchor });
}

const arrowRangeCases = (["ordinary", "reordered", "condensed-neighbours"] as const).flatMap((layout) =>
  [false, true].flatMap((rendered) =>
    ["ArrowUp", "ArrowDown"].flatMap((arrow) =>
      ["Delete", "Alt+ArrowUp"].map((edit) => ({ layout, rendered, arrow, edit })),
    ),
  ),
);

function expectBindingRangeEdit(
  score: Score,
  chordId: string,
  anchor: MeasureSelectionPoint,
  arrow: string,
  edit: string,
  sources: { partIndex: number; sequenceIndex: number }[],
): void {
  const before = structuredClone(score);
  const harness = bindingHarness(score, chordSingle(chordId, anchor));
  const targetPart = anchor.partIndex + (arrow === "ArrowDown" ? 1 : -1);

  harness.press(`Shift+${arrow}`);

  expect(harness.extendSelection).toHaveBeenCalledTimes(1);
  expect(harness.selectElement).not.toHaveBeenCalled();
  expect(harness.ctx.getSelection()).toMatchObject({
    kind: "range",
    startElementId: chordId,
    endElementId: `p${targetPart}/m0/s0/note-${targetPart}-0`,
    measureAnchor: anchor,
  });
  expect(resolveSelectionEvents(harness.ctx.getSelection(), score)).toEqual(
    sources.map((source) => ({ ...source, measureIndex: 0, eventIndex: 0 })),
  );
  expect(harness.current()).toEqual(before);

  harness.press(edit);

  const expected = structuredClone(before);
  for (const { partIndex, sequenceIndex } of sources) {
    const event = eventAt(expected, partIndex, sequenceIndex);
    if (edit === "Delete") {
      delete event.notes;
      event.id = expect.any(String);
      event.rest = {};
    } else {
      event.notes![0]!.pitch = { step: "D", octave: 4 };
    }
  }
  expect(harness.current()).toEqual(expected);
  expect(harness.current().global).toEqual(before.global);
  expect(score).toEqual(before);
  if (edit === "Delete") {
    expect(harness.updateScore).toHaveBeenCalledTimes(1);
    expect(harness.commitPatches).not.toHaveBeenCalled();
    expect(harness.ctx.getSelection()).toEqual({ kind: "none" });
  } else {
    expect(harness.commitPatches).toHaveBeenCalledExactlyOnceWith(
      sources.map(({ partIndex, sequenceIndex }) => expectedPatch(partIndex, sequenceIndex)),
    );
    expect(harness.updateScore).not.toHaveBeenCalled();
  }
  harness.history.getState().undo();
  expect(harness.current()).toEqual(before);
}

describe("global chord keyboard binding source regression", () => {
  it.each(arrowRangeCases.filter(({ layout, arrow }) => layout !== "condensed-neighbours" || arrow === "ArrowDown"))(
    "third of four sources: Shift+$arrow then $edit ($layout rendered=$rendered)",
    ({ layout, rendered, arrow, edit }) => {
      const anchor = arrowAnchor(2, layout);
      const chordId = rendered ? `m0/chord0/p${anchor.staffIndex}/staff${anchor.staffIndex}` : "m0/chord0";
      expectBindingRangeEdit(
        arrowFixture(layout),
        chordId,
        anchor,
        arrow,
        edit,
        (arrow === "ArrowDown" ? [2, 3] : [1, 2]).map((partIndex) => ({ partIndex, sequenceIndex: 0 })),
      );
    },
  );

  it.each([false, true].flatMap((rendered) => ["Delete", "Alt+ArrowUp"].map((edit) => ({ rendered, edit }))))(
    "middle of three sources: Shift+ArrowDown then $edit selects only [1,2] (rendered=$rendered)",
    ({ rendered, edit }) => {
      expectBindingRangeEdit(
        fixture(),
        rendered ? "m0/chord0/p1/staff1" : "m0/chord0",
        arrowAnchor(1),
        "ArrowDown",
        edit,
        [1, 2].map((partIndex) => ({ partIndex, sequenceIndex: 0 })),
      );
    },
  );

  it.each([false, true].flatMap((rendered) => ["Delete", "Alt+ArrowUp"].map((edit) => ({ rendered, edit }))))(
    "source secondary staff: Shift+ArrowDown then $edit excludes its primary staff (rendered=$rendered)",
    ({ rendered, edit }) => {
      expectBindingRangeEdit(
        arrowFixture("secondary"),
        rendered ? "m0/chord0/p0/staff0" : "m0/chord0",
        arrowAnchor(2, "secondary"),
        "ArrowDown",
        edit,
        [
          { partIndex: 2, sequenceIndex: 1 },
          { partIndex: 3, sequenceIndex: 0 },
        ],
      );
    },
  );

  it.each(arrowRangeCases.filter(({ edit }) => edit === "Delete"))(
    "plain $arrow navigates from the source without editing ($layout rendered=$rendered)",
    ({ layout, rendered, arrow }) => {
      const score = arrowFixture(layout);
      const before = structuredClone(score);
      const anchor = arrowAnchor(2, layout);
      const harness = bindingHarness(score, chordSingle(rendered ? "m0/chord0/p0/staff0" : "m0/chord0", anchor));

      harness.press(arrow);

      const targetPart = arrow === "ArrowUp" ? 1 : 3;
      expect(harness.ctx.getSelection()).toMatchObject({
        kind: "single",
        elementId: `p${targetPart}/m0/s0/note-${targetPart}-0`,
      });
      expect(harness.selectElement).toHaveBeenCalledTimes(1);
      expect(harness.extendSelection).not.toHaveBeenCalled();
      expect(harness.commitPatches).not.toHaveBeenCalled();
      expect(harness.updateScore).not.toHaveBeenCalled();
      expect(harness.current()).toEqual(before);
    },
  );

  it.each([false, true].flatMap((rendered) => ["Alt+ArrowUp", "Alt+ArrowDown"].map((key) => ({ rendered, key }))))(
    "$key uses the anchored source's other-side annotation, not the copy (rendered=$rendered)",
    ({ rendered, key }) => {
      const score = arrowFixture("reordered");
      const before = structuredClone(score);
      const anchor = arrowAnchor(2, "reordered");
      const harness = bindingHarness(score, chordSingle(rendered ? "m0/chord0/p0/staff0" : "m0/chord0", anchor));

      harness.press(key);

      expect(harness.ctx.getSelection()).toMatchObject({
        kind: "single",
        elementId: "p2/m0/dynsource-2",
        measureAnchor: anchor,
      });
      expect(harness.selectElement).toHaveBeenCalledExactlyOnceWith("p2/m0/dynsource-2", anchor);
      expect(harness.extendSelection).not.toHaveBeenCalled();
      expect(harness.commitPatches).not.toHaveBeenCalled();
      expect(harness.updateScore).not.toHaveBeenCalled();
      expect(harness.current()).toEqual(before);
    },
  );

  const unresolvedCases = [
    { name: "missing anchor", anchor: undefined },
    { name: "explicitly unresolved source staff", anchor: { ...arrowAnchor(2), sourceStaff: null } },
    { name: "invalid source part", anchor: { ...arrowAnchor(2), partIndex: 99 } },
    { name: "invalid source staff", anchor: { ...arrowAnchor(2), sourceStaff: 9 } },
  ].flatMap(({ name, anchor }) =>
    ["m0/chord0", "m0/chord0/p0/staff0", "m0/chord0/p99/staff99"].flatMap((chordId) =>
      ["ArrowUp", "ArrowDown", "Shift+ArrowUp", "Shift+ArrowDown", "Alt+ArrowUp", "Alt+ArrowDown"].map((key) => ({
        name,
        anchor,
        chordId,
        key,
      })),
    ),
  );

  it.each(unresolvedCases)("$key fails closed for $chordId with $name", ({ chordId, anchor, key }) => {
    const score = arrowFixture();
    const before = structuredClone(score);
    const selection = chordSingle(chordId, anchor);
    const harness = bindingHarness(score, selection);

    harness.press(key);

    expect(harness.ctx.getSelection()).toEqual(selection);
    expect(harness.selectElement).not.toHaveBeenCalled();
    expect(harness.extendSelection).not.toHaveBeenCalled();
    expect(harness.commitPatches).not.toHaveBeenCalled();
    expect(harness.updateScore).not.toHaveBeenCalled();
    expect(harness.history.getState().canUndo).toBe(false);
    expect(harness.current()).toEqual(before);
    expect(score).toEqual(before);
  });

  it.each(
    [false, true].flatMap((rendered) =>
      [false, true].flatMap((withFocus) => ["ArrowUp", "ArrowDown"].map((arrow) => ({ rendered, withFocus, arrow }))),
    ),
  )(
    "moving chord endpoint uses focus or reliable opposite note: Shift+$arrow (focus=$withFocus rendered=$rendered)",
    ({ rendered, withFocus, arrow }) => {
      const score = arrowFixture("reordered");
      const before = structuredClone(score);
      const chordId = rendered ? "m0/chord0/p0/staff0" : "m0/chord0";
      const fixedPart = withFocus ? 0 : 2;
      const anchor = withFocus ? arrowAnchor(fixedPart) : undefined;
      const selection = clickRange(
        chordId,
        noteId(fixedPart),
        anchor,
        true,
        withFocus ? arrowAnchor(2, "reordered") : undefined,
      );
      const harness = bindingHarness(score, selection);

      harness.press(`Shift+${arrow}`);

      const targetPart = arrow === "ArrowUp" ? 1 : 3;
      expect(harness.ctx.getSelection()).toMatchObject({
        kind: "range",
        startElementId: noteId(fixedPart),
        endElementId: `p${targetPart}/m0/s0/note-${targetPart}-0`,
        ...(anchor && { measureAnchor: anchor }),
      });
      expect(harness.extendSelection).toHaveBeenCalledTimes(1);
      expect(harness.selectElement).not.toHaveBeenCalled();
      expect(harness.commitPatches).not.toHaveBeenCalled();
      expect(harness.updateScore).not.toHaveBeenCalled();
      expect(harness.current()).toEqual(before);
    },
  );

  it.each(
    [false, true].flatMap((rendered) =>
      [false, true].flatMap((invalidFocus) =>
        ["ArrowUp", "ArrowDown", "Shift+ArrowUp", "Shift+ArrowDown"].map((key) => ({
          rendered,
          invalidFocus,
          key,
        })),
      ),
    ),
  )(
    "$key cannot infer a moving chord's source from unresolved range context (invalidFocus=$invalidFocus rendered=$rendered)",
    ({ rendered, invalidFocus, key }) => {
      const score = arrowFixture("reordered");
      const before = structuredClone(score);
      const chordId = rendered ? "m0/chord0/p0/staff0" : "m0/chord0";
      const selection = clickRange(
        chordId,
        invalidFocus ? noteId(2) : "m0/chord1",
        invalidFocus ? arrowAnchor(2) : undefined,
        true,
        invalidFocus ? { ...arrowAnchor(2, "reordered"), sourceStaff: null } : undefined,
      );
      const harness = bindingHarness(score, selection);

      harness.press(key);

      expect(harness.ctx.getSelection()).toEqual(selection);
      expect(harness.selectElement).not.toHaveBeenCalled();
      expect(harness.extendSelection).not.toHaveBeenCalled();
      expect(harness.commitPatches).not.toHaveBeenCalled();
      expect(harness.updateScore).not.toHaveBeenCalled();
      expect(harness.current()).toEqual(before);
    },
  );
});
