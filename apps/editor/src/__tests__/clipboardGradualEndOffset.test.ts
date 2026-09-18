import { describe, expect, it } from "vitest";
import { measureBeats, type NoteEvent, type Score, type TimeSignature } from "@viritura/core";
import type { CapturedDynamic } from "../clipboard/ClipboardFragment";
import { buildClipboardSelection } from "../clipboard/buildClipboardSelection";
import { deserializeFragment } from "../clipboard/deserialize";
import { serializeFragment } from "../clipboard/serialize";
import {
  applyPaste,
  pasteResultFromFragment,
  type ClipboardSelection,
  type PasteResult,
} from "../commands/clipboardCommands";

const twoFour: TimeSignature = { count: 2, unit: 4 };
const sixEight: TimeSignature = { count: 6, unit: 8 };

function notes(count: number, prefix = "import"): NoteEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    type: "event",
    id: `${prefix}-${index}`,
    duration: { base: "eighth" },
    notes: [{ id: `${prefix}-${index}-note`, pitch: { step: "C", octave: 4 } }],
  }));
}

function score(times: TimeSignature[], prefix = "target"): Score {
  return {
    mnx: { version: 1 },
    global: { measures: times.map((time, index) => ({ id: `${prefix}-m${index}`, time })) },
    parts: [
      {
        staves: 1,
        measures: times.map((time, index) => ({
          sequences: [{ staff: 1, content: notes(measureBeats(time) * 2, `${prefix}-m${index}`) }],
        })),
      },
    ],
  };
}

function hairpin(overrides: Partial<CapturedDynamic> = {}): CapturedDynamic {
  return {
    measureOffset: 0,
    endMeasureOffset: 0,
    offset: [1, 4],
    endOffset: [3, 4],
    dynamic: {
      id: "source-hairpin",
      type: "gradual",
      wedgeType: "increasing",
      position: { fraction: [1, 4] },
      end: { measure: "source-m7", position: { fraction: [3, 4] } },
    },
    ...overrides,
  };
}

function range(
  source: Score,
  startMeasure: number,
  startEvent: number,
  endMeasure: number,
  endEvent: number,
): ClipboardSelection {
  const eventPath = (measureIndex: number, eventIndex: number) => {
    const event = source.parts[0]!.measures[measureIndex]!.sequences[0]!.content[eventIndex]!;
    expect(event.type).toBe("event");
    return `p0/m${measureIndex}/s0/${(event as NoteEvent).id}`;
  };
  const selection = buildClipboardSelection(source, {
    kind: "range",
    startElementId: eventPath(startMeasure, startEvent),
    endElementId: eventPath(endMeasure, endEvent),
  });
  expect(selection).not.toBeNull();
  return selection!;
}

function roundTrip(selection: ClipboardSelection): PasteResult {
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
      selection.lyrics,
      selection.chordSymbols,
    ),
  );
  expect(fragment).not.toBeNull();
  expect(fragment!.dynamics).toEqual(selection.dynamics);
  expect(fragment!.tracks?.map((track) => track.dynamics)).toEqual(selection.tracks?.map((track) => track.dynamics));
  return pasteResultFromFragment(fragment!);
}

function expectOffsets(paste: PasteResult, start: number, end: number): void {
  const trackDynamics = paste.tracks?.flatMap((track) => track.dynamics ?? []) ?? [];
  const dynamics = trackDynamics.length > 0 ? trackDynamics : paste.dynamics;
  expect(dynamics).toHaveLength(1);
  const captured = dynamics![0]!;
  expect(captured.offset).toBeDefined();
  expect(captured.endOffset).toBeDefined();
  expect(captured.offset![0] / captured.offset![1]).toBe(start);
  expect(captured.endOffset![0] / captured.endOffset![1]).toBe(end);
}

function expectHairpin(
  result: Score,
  startMeasure: number,
  startNumerator: number,
  endMeasure: number,
  endNumerator: number,
): void {
  const dynamics = result.parts[0]!.measures.flatMap((measure) => measure.dynamics ?? []);
  expect(dynamics).toHaveLength(1);
  expect(result.parts[0]!.measures[startMeasure]!.dynamics?.map((dynamic) => ({ staff: 1, ...dynamic }))).toEqual([
    {
      id: expect.any(String),
      type: "gradual",
      wedgeType: "increasing",
      staff: 1,
      position: { fraction: [startNumerator, 16] },
      end: { measure: result.global.measures[endMeasure]!.id, position: { fraction: [endNumerator, 16] } },
    },
  ]);
}

describe("clipboard gradual absolute end offsets", () => {
  it.each([
    { placement: "single", absoluteStart: true },
    { placement: "single", absoluteStart: false },
    { placement: "physical track", absoluteStart: true },
    { placement: "physical track", absoluteStart: false },
    { placement: "legacy track", absoluteStart: true },
    { placement: "legacy track", absoluteStart: false },
  ])(
    "maps a 6/8 selection end to 2/4 bar 2 beat 1 ($placement, offset: $absoluteStart)",
    ({ placement, absoluteStart }) => {
      for (const endMeasureOffset of [undefined, 0, 99]) {
        const captured = hairpin({ offset: absoluteStart ? [1, 4] : undefined, endMeasureOffset });
        const content = notes(6);
        const paste: PasteResult = {
          content,
          sourceTimeSignature: sixEight,
          ...(placement === "single"
            ? { dynamics: [captured] }
            : {
                tracks: [
                  {
                    partOffset: 0,
                    voiceIndex: 0,
                    ...(placement === "physical track" ? { staffOffset: 0, sourceStaff: 1 } : {}),
                    content,
                    dynamics: [captured],
                  },
                ],
              }),
        };
        const target = score([twoFour, twoFour]);
        const targetSnapshot = structuredClone(target);
        const pasteSnapshot = structuredClone(paste);
        const result = applyPaste(target, paste, 0, 0, 0, 0);
        expectHairpin(result, 0, 4, 1, 4);
        const recaptured = roundTrip(range(result, 0, 0, 1, 1));
        expectOffsets(recaptured, 1 / 4, 3 / 4);
        expectHairpin(applyPaste(target, recaptured, 0, 0, 0, 0), 0, 4, 1, 4);
        expect(target).toEqual(targetSnapshot);
        expect(paste).toEqual(pasteSnapshot);
      }
    },
  );

  it.each([true, false])(
    "keeps the exact selection-end barline at a nonzero paste origin (offset: %s)",
    (absoluteStart) => {
      const target = score([twoFour, twoFour, twoFour]);
      delete target.global.measures[2]!.time;
      const captured = hairpin({
        offset: absoluteStart ? [1, 8] : undefined,
        endMeasureOffset: 99,
        dynamic: { ...hairpin().dynamic, position: { fraction: [1, 8] } },
      });
      const result = applyPaste(target, { content: notes(6), dynamics: [captured] }, 0, 1, 0, 2);
      expectHairpin(result, 1, 6, 2, 8);
      expect(result.global.measures).toHaveLength(3);
      const recaptured = roundTrip(range(result, 1, 2, 2, 3));
      expectOffsets(recaptured, 1 / 8, 3 / 4);
      expectHairpin(applyPaste(target, recaptured, 0, 1, 0, 2), 1, 6, 2, 8);
    },
  );

  it("preserves the source timeline from a nonzero source measure/beat across a meter change", () => {
    const source = score([{ count: 4, unit: 4 }, sixEight, { count: 3, unit: 4 }], "source");
    const selected = range(source, 1, 2, 2, 3);
    expect(selected.captureOrigin).toEqual({ measureIndex: 1, beat: 1 });
    expect(selected.timeSignature).toEqual(sixEight);
    // Source m1 beat 1 -> m2 beat 2 spans four beats; the hairpin starts at m2 beat 1/2.
    const captured = hairpin({
      measureOffset: 1,
      endMeasureOffset: 1,
      offset: [5, 8],
      endOffset: [1, 1],
      dynamic: {
        ...hairpin().dynamic,
        position: { fraction: [1, 8] },
        end: { measure: "source-m2", position: { fraction: [1, 2] } },
      },
    });
    const target = score([twoFour, twoFour, twoFour, twoFour]);
    const result = applyPaste(
      target,
      { content: selected.events, sourceTimeSignature: selected.timeSignature, dynamics: [captured] },
      0,
      1,
      0,
      2,
    );
    expectHairpin(result, 2, 6, 3, 4);
    const recaptured = roundTrip(range(result, 1, 2, 3, 1));
    expectOffsets(recaptured, 5 / 8, 1);
    expectHairpin(applyPaste(target, recaptured, 0, 1, 0, 2), 2, 6, 3, 4);
  });

  it("walks destination meter changes rather than source measure offsets", () => {
    const target = score([twoFour, { count: 3, unit: 8 }, { count: 3, unit: 8 }]);
    delete target.global.measures[2]!.time;
    const captured = hairpin({ offset: undefined, endOffset: [5, 4], endMeasureOffset: 0 });
    const result = applyPaste(target, { content: notes(10), dynamics: [captured] }, 0, 0, 0, 0);
    expectHairpin(result, 0, 4, 2, 6);
    const recaptured = roundTrip(range(result, 0, 0, 2, 2));
    expectOffsets(recaptured, 1 / 4, 5 / 4);
    expectHairpin(applyPaste(target, recaptured, 0, 0, 0, 0), 0, 4, 2, 6);
  });

  it.each([
    { endMeasureOffset: 0, fraction: [3, 4] as [number, number], measure: 1, numerator: 16 },
    { endMeasureOffset: 1, fraction: [1, 4] as [number, number], measure: 2, numerator: 4 },
  ])(
    "keeps legacy endpoint mapping without endOffset (end measure offset: $endMeasureOffset)",
    ({ endMeasureOffset, fraction, measure, numerator }) => {
      const target = score(Array.from({ length: 3 }, () => ({ count: 4, unit: 4 })));
      const captured = hairpin({
        offset: undefined,
        endOffset: undefined,
        endMeasureOffset,
        dynamic: { ...hairpin().dynamic, end: { measure: "source-end", position: { fraction } } },
      });
      const result = applyPaste(target, { content: notes(6), dynamics: [captured] }, 0, 1, 0, 2);
      expectHairpin(result, 1, 8, measure, numerator);
    },
  );

  it("still drops an absolute-start hairpin without endOffset rather than guessing a legacy endpoint", () => {
    const target = score([twoFour, twoFour]);
    const result = applyPaste(
      target,
      { content: notes(6), dynamics: [hairpin({ endOffset: undefined, endMeasureOffset: 1 })] },
      0,
      0,
      0,
      0,
    );
    expect(result.parts[0]!.measures.flatMap((measure) => measure.dynamics ?? [])).toEqual([]);
  });
});
