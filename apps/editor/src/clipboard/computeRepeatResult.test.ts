import { describe, expect, it } from "vitest";
import { walkSequenceEvents, type NoteEvent, type Score, type SequenceContent } from "@viritura/core";
import type { ClipboardSelection } from "../commands/clipboardCommands";
import { sequenceContentBeats } from "../commands/noteCommands";
import { getEventAtLocation, resolveEventLocation } from "../score/ElementPath";
import { resolveRangeElementIds } from "../store/selectionUtils";
import { buildClipboardSelection } from "./buildClipboardSelection";
import { computeRepeatResult } from "./computeRepeatResult";

function note(id: string, duration: NoteEvent["duration"] = { base: "quarter" }): NoteEvent {
  return {
    type: "event",
    id,
    duration,
    notes: [{ id: `${id}-note`, pitch: { step: "C", octave: 4 } }],
  };
}

function rest(id: string, duration: NoteEvent["duration"] = { base: "half", dots: 1 }): NoteEvent {
  return { type: "event", id, duration, rest: {} };
}

function staffScore(staves: number[]): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        staves: Math.max(...staves),
        measures: [
          {
            sequences: staves.map((staff, index) => ({
              staff,
              content: [note(`source-${index}`), rest(`rest-${index}`)],
            })),
          },
        ],
      },
    ],
  };
}

function content(score: Score, sequence = 0, measure = 0, part = 0): SequenceContent[] {
  return score.parts[part]!.measures[measure]!.sequences[sequence]!.content;
}

function selectedEvents(result: NonNullable<ReturnType<typeof computeRepeatResult>>): NoteEvent[] {
  expect(result.range).not.toBeNull();
  return resolveRangeElementIds(result.range!.start, result.range!.end, result.newScore).map((elementId) => {
    const location = resolveEventLocation(elementId, result.newScore);
    expect(location).not.toBeNull();
    const event = getEventAtLocation(result.newScore, location!);
    expect(event).not.toBeNull();
    return event!;
  });
}

function scoreIds(score: Score): string[] {
  return score.parts.flatMap((part) =>
    part.measures.flatMap((measure) =>
      measure.sequences.flatMap((sequence) =>
        [...walkSequenceEvents(sequence.content)].flatMap(({ event }) => [
          event.id!,
          ...(event.notes ?? []).map((entry) => entry.id!),
        ]),
      ),
    ),
  );
}

function reselect(result: NonNullable<ReturnType<typeof computeRepeatResult>>): ClipboardSelection {
  expect(result.selection).not.toBeNull();
  return buildClipboardSelection(result.newScore, result.selection!)!;
}

function expectTiesResolve(score: Score): void {
  const ids = new Set(scoreIds(score));
  for (const part of score.parts) {
    for (const measure of part.measures) {
      for (const sequence of measure.sequences) {
        for (const { event } of walkSequenceEvents(sequence.content)) {
          for (const entry of event.notes ?? []) {
            for (const tie of entry.ties ?? []) expect(ids.has(tie.target!)).toBe(true);
          }
        }
      }
    }
  }
}

describe("computeRepeatResult", () => {
  it.each([
    { label: "two staves", staves: [1, 2] },
    { label: "two voices", staves: [1, 1] },
    { label: "two voices on each staff", staves: [1, 1, 2, 2] },
  ])("advances sequential same-part repeats across $label instead of overwriting", ({ staves }) => {
    let score = staffScore(staves);
    let selection = buildClipboardSelection(score, {
      kind: "range",
      startElementId: "p0/m0/s0/source-0",
      endElementId: `p0/m0/s${staves.length - 1}/source-${staves.length - 1}`,
    })!;
    expect(selection.tracks).toHaveLength(staves.length);
    const previousIds = staves.map((_, index) => [`source-${index}`]);

    for (let repeat = 1; repeat <= 3; repeat++) {
      const snapshot = structuredClone({ score, selection });
      const result = computeRepeatResult(score, selection)!;
      const selected = selectedEvents(result);

      expect(selected).toHaveLength(staves.length);
      for (const [sequence, ids] of previousIds.entries()) {
        const placed = content(result.newScore, sequence);
        expect(placed.slice(0, repeat).map((item) => (item.type === "event" ? item.id : undefined))).toEqual(ids);
        const repeated = placed[repeat] as NoteEvent;
        expect(repeated).toMatchObject({ type: "event", duration: { base: "quarter" }, notes: [expect.anything()] });
        expect(selected.map((event) => event.id)).toContain(repeated.id);
        expect(scoreIds(score)).not.toContain(repeated.id);
        ids.push(repeated.id!);
      }
      const allIds = scoreIds(result.newScore);
      expect(new Set(allIds).size).toBe(allIds.length);
      expect({ score, selection }).toEqual(snapshot);

      score = result.newScore;
      selection = reselect(result);
    }
  });

  it.each([false, true])("remaps cross-track ties and slur endpoints (separate parts: %s)", (separateParts) => {
    const score = staffScore([1, 2]);
    if (separateParts) {
      const lower = score.parts[0]!.measures[0]!.sequences.pop()!;
      lower.staff = 1;
      score.parts[0]!.staves = 1;
      score.parts.push({ measures: [{ sequences: [lower] }] });
    }
    const lowerPart = separateParts ? 1 : 0;
    const lowerSequence = separateParts ? 0 : 1;
    const source = content(score)[0] as NoteEvent;
    const target = content(score, lowerSequence, 0, lowerPart)[0] as NoteEvent;
    source.slurs = [{ target: target.id!, startNote: source.notes![0]!.id, endNote: target.notes![0]!.id, side: "up" }];
    source.notes![0]!.ties = [{ target: target.notes![0]!.id }];
    const selection = buildClipboardSelection(score, {
      kind: "range",
      startElementId: "p0/m0/s0/source-0",
      endElementId: `p${lowerPart}/m0/s${lowerSequence}/source-1`,
    })!;
    // Serialized clipboard payloads can hold a separate primary copy and non-primary-first tracks.
    selection.events = structuredClone(selection.events);
    selection.tracks!.reverse();
    const snapshot = structuredClone({ score, selection });

    const result = computeRepeatResult(score, selection)!;
    const repeatedSource = content(result.newScore)[1] as NoteEvent;
    const repeatedTarget = content(result.newScore, lowerSequence, 0, lowerPart)[1] as NoteEvent;

    expect(repeatedSource.slurs).toEqual([
      {
        target: repeatedTarget.id,
        startNote: repeatedSource.notes![0]!.id,
        endNote: repeatedTarget.notes![0]!.id,
        side: "up",
      },
    ]);
    expect(repeatedSource.notes![0]!.ties).toEqual([{ target: repeatedTarget.notes![0]!.id }]);
    expect(repeatedSource.id).not.toBe(source.id);
    expect(repeatedTarget.id).not.toBe(target.id);
    expect(repeatedSource.notes![0]!.id).not.toBe(source.notes![0]!.id);
    expect(repeatedTarget.notes![0]!.id).not.toBe(target.notes![0]!.id);
    expect(selectedEvents(result).map((event) => event.id)).toEqual([repeatedSource.id, repeatedTarget.id]);
    expect({ score, selection }).toEqual(snapshot);
  });

  it.each([false, true])("selects split continuations, not remainder rests (with tracks: %s)", (withTracks) => {
    const score = staffScore(withTracks ? [1, 2] : [1]);
    for (const [index, sequence] of score.parts[0]!.measures[0]!.sequences.entries()) {
      sequence.content = [
        note(`source-${index}`, { base: "half", dots: 1 }),
        rest(`rest-${index}`, { base: "quarter" }),
      ];
    }
    score.global.measures.push({});
    score.parts[0]!.measures.push({
      sequences: score.parts[0]!.measures[0]!.sequences.map((sequence, index) => ({
        staff: sequence.staff,
        content: [rest(`next-${index}`, { base: "whole" })],
      })),
    });
    const events = [content(score)[0]!];
    const selection: ClipboardSelection = {
      events,
      timeSignature: { count: 4, unit: 4 },
      keySignature: { fifths: 0 },
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
      ...(withTracks
        ? {
            tracks: [0, 1].map((index) => ({
              partOffset: 0,
              staffOffset: index,
              voiceIndex: 0,
              content: [content(score, index)[0]!],
            })),
          }
        : {}),
    };
    const snapshot = structuredClone({ score, selection });
    const result = computeRepeatResult(score, selection)!;
    const selected = selectedEvents(result);
    const first = content(result.newScore)[1] as NoteEvent;
    const last = content(result.newScore, withTracks ? 1 : 0, 1)[0] as NoteEvent;

    expect(result.range).toEqual({ start: `p0/m0/s0/${first.id}`, end: `p0/m1/s${withTracks ? 1 : 0}/${last.id}` });
    expect(selected).toHaveLength(withTracks ? 4 : 2);
    for (let sequence = 0; sequence < (withTracks ? 2 : 1); sequence++) {
      const head = content(result.newScore, sequence)[1] as NoteEvent;
      const continuation = content(result.newScore, sequence, 1)[0] as NoteEvent;
      const remainder = content(result.newScore, sequence, 1)[1] as NoteEvent;
      expect(head.duration).toEqual({ base: "quarter" });
      expect(continuation.duration).toEqual({ base: "half" });
      expect(continuation.id).not.toBe(head.id);
      expect(continuation.notes![0]!.id).not.toBe(head.notes![0]!.id);
      expect(head.notes![0]!.ties).toEqual([{ target: continuation.notes![0]!.id }]);
      expect(selected.map((event) => event.id)).toContain(continuation.id);
      expect(remainder.rest).toEqual({});
      expect(selected.map((event) => event.id)).not.toContain(remainder.id);
    }
    expect({ score, selection }).toEqual(snapshot);

    const automaticSelection = reselect(result);
    const repeated = computeRepeatResult(result.newScore, automaticSelection)!;
    const repeatedSelection = selectedEvents(repeated);
    for (let sequence = 0; sequence < (withTracks ? 2 : 1); sequence++) {
      expect(content(repeated.newScore, sequence, 0).slice(0, 2)).toEqual(content(result.newScore, sequence, 0));
      expect(content(repeated.newScore, sequence, 1)[0]).toEqual(content(result.newScore, sequence, 1)[0]);
      const placed = content(repeated.newScore, sequence, 1);
      const head = placed[1] as NoteEvent;
      const middle = placed[2] as NoteEvent;
      const tail = content(repeated.newScore, sequence, 2)[0] as NoteEvent;
      expect(head.duration).toEqual({ base: "quarter" });
      expect(middle.duration).toEqual({ base: "quarter" });
      expect(tail.duration).toEqual({ base: "quarter" });
      expect(head.notes![0]!.ties).toEqual([{ target: middle.notes![0]!.id }]);
      expect(middle.notes![0]!.ties).toEqual([{ target: tail.notes![0]!.id }]);
      expect(repeatedSelection.map((event) => event.id)).toContain(head.id);
      expect(repeatedSelection.map((event) => event.id)).toContain(tail.id);
    }
    expectTiesResolve(repeated.newScore);
    expect(new Set(scoreIds(repeated.newScore)).size).toBe(scoreIds(repeated.newScore).length);
  });

  it.each([
    { separateParts: false, longerPrimary: false },
    { separateParts: false, longerPrimary: true },
    { separateParts: true, longerPrimary: false },
    { separateParts: true, longerPrimary: true },
  ])("uses the latest rhythmic end, retaining the primary context: %j", ({ separateParts, longerPrimary }) => {
    const score = staffScore([1, 1]);
    for (let sequence = 0; sequence < 2; sequence++) {
      const longer = (sequence === 0) === longerPrimary;
      score.parts[0]!.measures[0]!.sequences[sequence]!.content = [
        note(`source-${sequence}`, { base: "half", ...(longer ? { dots: 1 } : {}) }),
        rest(`rest-${sequence}`, { base: longer ? "quarter" : "half" }),
      ];
    }
    if (separateParts) {
      score.parts.push({ measures: [{ sequences: [score.parts[0]!.measures[0]!.sequences.pop()!] }] });
    }
    const selection = buildClipboardSelection(score, {
      kind: "range",
      startElementId: "p0/m0/s0/source-0",
      endElementId: separateParts ? "p1/m0/s0/source-1" : "p0/m0/s1/source-1",
    })!;
    const first = computeRepeatResult(score, selection)!;
    const automaticSelection = reselect(first);
    // cutLocations are source positions, not an ordered list of range endpoints.
    automaticSelection.cutLocations!.reverse();
    automaticSelection.tracks!.reverse();
    const snapshot = structuredClone({ score: first.newScore, selection: automaticSelection });
    const second = computeRepeatResult(first.newScore, automaticSelection)!;

    for (let track = 0; track < 2; track++) {
      const part = separateParts ? track : 0;
      const sequence = separateParts ? 0 : track;
      const firstBar = content(first.newScore, sequence, 0, part);
      expect(firstBar.slice(0, -1).reduce((sum, item) => sum + sequenceContentBeats(item), 0)).toBe(3);
      expect(content(second.newScore, sequence, 0, part)).toEqual(firstBar);
      expect(content(second.newScore, sequence, 1, part)[0]).toEqual(content(first.newScore, sequence, 1, part)[0]);
      const placed = content(second.newScore, sequence, 1, part);
      const selectedIds = new Set(selectedEvents(second).map((event) => event.id));
      const firstSelected = placed.findIndex((item) => item.type === "event" && selectedIds.has(item.id));
      expect(firstSelected).toBeGreaterThan(0);
      expect(placed.slice(0, firstSelected).reduce((sum, item) => sum + sequenceContentBeats(item), 0)).toBe(2);
    }
    expect(reselect(second)).toMatchObject({ partIndex: 0, measureIndex: 1, sequenceIndex: 0 });
    expectTiesResolve(second.newScore);
    expect({ score: first.newScore, selection: automaticSelection }).toEqual(snapshot);
  });

  it("follows the primary staff and voice when sequences change order between bars", () => {
    const score = staffScore([1, 1, 2, 2]);
    for (const [index, sequence] of score.parts[0]!.measures[0]!.sequences.entries()) {
      sequence.content = [
        note(`source-${index}`, { base: "half", dots: 1 }),
        rest(`rest-${index}`, { base: "quarter" }),
      ];
      (sequence.content[0] as NoteEvent).notes![0]!.pitch.octave = index + 3;
    }
    score.global.measures.push({});
    score.parts[0]!.measures.push({
      sequences: [2, 2, 1, 1].map((staff, index) => ({
        staff,
        content: [rest(`next-${index}`, { base: "whole" })],
      })),
    });
    const selection = buildClipboardSelection(score, {
      kind: "range",
      startElementId: "p0/m0/s0/source-0",
      endElementId: "p0/m0/s3/source-3",
    })!;
    const first = computeRepeatResult(score, selection)!;
    const automaticSelection = reselect(first);
    const second = computeRepeatResult(first.newScore, automaticSelection)!;

    for (const [originalSequence, nextSequence] of [2, 3, 0, 1].entries()) {
      expect(content(second.newScore, originalSequence)).toEqual(content(first.newScore, originalSequence));
      expect(content(second.newScore, nextSequence, 1)[0]).toEqual(content(first.newScore, nextSequence, 1)[0]);
      const repeated = content(second.newScore, nextSequence, 1)[1] as NoteEvent;
      expect(repeated.notes![0]!.pitch.octave).toBe(originalSequence + 3);
      expect(sequenceContentBeats(content(second.newScore, nextSequence, 1)[0]!)).toBe(2);
      expect(selectedEvents(second).map((event) => event.id)).toContain(repeated.id);
    }
    expectTiesResolve(second.newScore);
  });

  it("anchors on the primary physical track rather than the lowest endpoint sequence index", () => {
    const score = staffScore([2, 1]);
    (content(score, 0)[0] as NoteEvent).notes![0]!.pitch.octave = 3;
    score.parts.push({
      measures: [{ sequences: [{ content: [note("unselected", { base: "whole" })] }] }],
    });
    let selection = buildClipboardSelection(score, {
      kind: "range",
      startElementId: "p0/m0/s0/source-0",
      endElementId: "p0/m0/s1/source-1",
    })!;
    expect(selection.sequenceIndex).toBe(0);
    expect(selection.events[0]).toMatchObject({ id: "source-1" });
    let current = score;
    for (let repeat = 1; repeat <= 2; repeat++) {
      const result = computeRepeatResult(current, selection)!;
      expect(result.newScore.parts[1]).toEqual(score.parts[1]);
      for (let sequence = 0; sequence < 2; sequence++) {
        const placed = content(result.newScore, sequence);
        expect(placed.slice(0, repeat)).toEqual(content(current, sequence).slice(0, repeat));
        expect(placed[repeat]).toMatchObject({
          type: "event",
          notes: [{ pitch: { octave: sequence === 0 ? 3 : 4 } }],
        });
      }
      current = result.newScore;
      selection = reselect(result);
    }
  });

  it("preserves an untouched primary note when a track lead-in moves past the shared repeat origin", () => {
    const score = staffScore([1, 2]);
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      { type: "space", duration: [1, 4] },
      note("source-0"),
      note("untouched", { base: "half" }),
    ];
    score.parts[0]!.measures[0]!.sequences[1]!.content = [
      note("source-1", { base: "half", dots: 1 }),
      rest("after", { base: "quarter" }),
    ];
    const selection = buildClipboardSelection(score, {
      kind: "range",
      startElementId: "p0/m0/s1/source-1",
      endElementId: "p0/m0/s0/source-0",
    })!;
    expect(selection.tracks![0]!.leadIn).toEqual([256, 1024]);
    const snapshot = structuredClone({ score, selection });
    const first = computeRepeatResult(score, selection)!;
    const second = computeRepeatResult(first.newScore, reselect(first))!;

    expect(content(first.newScore)).toEqual(content(score));
    expect(content(second.newScore)).toEqual(content(score));
    expect(content(first.newScore, 0, 1)[0]).toMatchObject({
      type: "event",
      duration: { base: "quarter" },
      notes: [{}],
    });
    expect(content(second.newScore, 0, 1)[0]).toEqual(content(first.newScore, 0, 1)[0]);
    expect(content(second.newScore, 1, 1)[0]).toEqual(content(first.newScore, 1, 1)[0]);
    expect(
      content(second.newScore, 0, 1)
        .slice(0, -1)
        .reduce((sum, item) => sum + sequenceContentBeats(item), 0),
    ).toBe(3);
    expect(content(second.newScore, 0, 1).at(-1)).toMatchObject({
      type: "event",
      duration: { base: "quarter" },
      notes: [{}],
    });
    expectTiesResolve(second.newScore);
    expect({ score, selection }).toEqual(snapshot);
  });

  it.each([{ staves: [1, 2] }, { staves: [2, 1] }])("anchors reverse-click selections: %j", ({ staves }) => {
    const score = staffScore(staves);
    for (const [index, sequence] of score.parts[0]!.measures[0]!.sequences.entries()) {
      sequence.content = [
        note(`source-${index}`, { base: "half", dots: 1 }),
        rest(`rest-${index}`, { base: "quarter" }),
      ];
      (sequence.content[0] as NoteEvent).notes![0]!.pitch.octave = sequence.staff === 1 ? 4 : 3;
    }
    for (let measure = 1; measure < 3; measure++) {
      score.global.measures.push({});
      score.parts[0]!.measures.push({
        sequences: staves.map((staff, index) => ({
          staff,
          content: [rest(`next-${measure}-${index}`, { base: "whole" })],
        })),
      });
    }
    score.parts.push({
      measures: [0, 1, 2].map((measure) => ({
        sequences: [{ content: [0, 1, 2, 3].map((beat) => note(`unselected-${measure}-${beat}`)) }],
      })),
    });
    const upper = staves.indexOf(1);
    const lower = staves.indexOf(2);
    let selection = buildClipboardSelection(score, {
      kind: "multi",
      elementIds: [`p0/m0/s${lower}/source-${lower}`, `p0/m0/s${upper}/source-${upper}`],
    })!;
    expect(selection.events[0]).toMatchObject({ id: `source-${lower}` });
    expect(selection.tracks![0]).toMatchObject({ staffOffset: 0, content: [{ id: `source-${upper}` }] });
    let current = score;
    for (let repeat = 1; repeat <= 2; repeat++) {
      const snapshot = structuredClone({ score: current, selection });
      const result = computeRepeatResult(current, selection)!;
      expect(result.newScore.parts[1]).toEqual(score.parts[1]);
      const selected = selectedEvents(result);
      expect(selected.reduce((sum, event) => sum + sequenceContentBeats(event), 0)).toBe(6);
      for (const sequence of [upper, lower]) {
        expect(content(result.newScore, sequence)[0]).toEqual(content(score, sequence)[0]);
        const head = content(result.newScore, sequence, repeat - 1)[1] as NoteEvent;
        const tail = content(result.newScore, sequence, repeat)[0] as NoteEvent;
        expect(head.notes![0]!.pitch.octave).toBe(sequence === upper ? 4 : 3);
        expect(tail.notes![0]!.pitch.octave).toBe(sequence === upper ? 4 : 3);
        expect(selected.map((event) => event.id)).toContain(head.id);
        expect(selected.map((event) => event.id)).toContain(tail.id);
        const next = repeat === 1 ? tail : (content(result.newScore, sequence, 1)[2] as NoteEvent);
        expect(head.notes![0]!.ties).toEqual([{ target: next.notes![0]!.id }]);
        if (repeat === 2) {
          expect(next.notes![0]!.ties).toEqual([{ target: tail.notes![0]!.id }]);
          expect(content(result.newScore, sequence, 0)).toEqual(content(current, sequence, 0));
          expect(content(result.newScore, sequence, 1)[0]).toEqual(content(current, sequence, 1)[0]);
        }
      }
      expectTiesResolve(result.newScore);
      expect(new Set(scoreIds(result.newScore)).size).toBe(scoreIds(result.newScore).length);
      expect({ score: current, selection }).toEqual(snapshot);
      current = result.newScore;
      selection = reselect(result);
    }
  });

  it.each([
    { restBeats: 4, startMeasure: 0 },
    { restBeats: 3, startMeasure: 0 },
    { restBeats: 4, startMeasure: 1 },
    { restBeats: 3, startMeasure: 1 },
  ])("retains selected full-measure rests through two automatic repeats: %j", ({ restBeats, startMeasure }) => {
    const score = staffScore([1]);
    score.global.measures = startMeasure ? [{ time: { count: 3, unit: 4 } }] : [];
    score.parts[0]!.measures = startMeasure
      ? [{ sequences: [{ content: [note("before", { base: "half", dots: 1 })] }] }]
      : [];
    for (let pair = 0; pair < 3; pair++) {
      score.global.measures.push({ time: { count: 4, unit: 4 } }, { time: { count: restBeats, unit: 4 } });
      score.parts[0]!.measures.push(
        { sequences: [{ content: pair === 0 ? [note("source", { base: "whole" })] : [] }] },
        { sequences: [{ content: [], fullMeasure: {} }] },
      );
    }
    let selection = buildClipboardSelection(score, {
      kind: "measure",
      startMeasure,
      endMeasure: startMeasure + 1,
      startPartIndex: 0,
      endPartIndex: 0,
    })!;
    expect(selection.cutLocations).toHaveLength(1);
    let current = score;
    for (let repeat = 1; repeat <= 2; repeat++) {
      const snapshot = structuredClone({ score: current, selection });
      const result = computeRepeatResult(current, selection)!;
      const noteMeasure = startMeasure + repeat * 2;
      expect(result.newScore.parts[0]!.measures.slice(0, noteMeasure)).toEqual(
        current.parts[0]!.measures.slice(0, noteMeasure),
      );
      expect(content(result.newScore, 0, noteMeasure)).toEqual([
        expect.objectContaining({ duration: { base: "whole" }, notes: [expect.anything()] }),
      ]);
      expect(content(result.newScore, 0, noteMeasure + 1)).toEqual([
        expect.objectContaining({
          duration: restBeats === 4 ? { base: "whole" } : { base: "half", dots: 1 },
          rest: expect.anything(),
        }),
      ]);
      expect(selectedEvents(result)).toHaveLength(2);
      expect(result.range!.start).toMatch(new RegExp(`^p0/m${noteMeasure}/s0/`));
      expect(result.range!.end).toMatch(new RegExp(`^p0/m${noteMeasure + 1}/s0/`));
      expect({ score: current, selection }).toEqual(snapshot);
      current = result.newScore;
      selection = reselect(result);
    }
  });

  it("anchors synthesized primary rests on their own staff when no source event ID exists", () => {
    const score = staffScore([2, 1]);
    score.parts[0]!.measures[0]!.sequences[0]!.content = [note("lower", { base: "whole" })];
    score.parts[0]!.measures[0]!.sequences[1] = { staff: 1, content: [], fullMeasure: {} };
    score.parts.push({ measures: [{ sequences: [{ content: [note("unselected", { base: "whole" })] }] }] });
    const selection = buildClipboardSelection(score, {
      kind: "measure",
      startMeasure: 0,
      endMeasure: 0,
      startPartIndex: 0,
      endPartIndex: 0,
    })!;
    const first = computeRepeatResult(score, selection)!;
    const second = computeRepeatResult(first.newScore, reselect(first))!;
    expect(second.newScore.parts[1]!.measures[0]).toEqual(score.parts[1]!.measures[0]);
    expect(second.newScore.parts[0]!.measures[0]).toEqual(score.parts[0]!.measures[0]);
    for (const measure of [1, 2]) {
      const sequences = second.newScore.parts[0]!.measures[measure]!.sequences;
      expect(sequences.find((sequence) => (sequence.staff ?? 1) === 1)!.content).toEqual([
        expect.objectContaining({ rest: expect.anything(), duration: { base: "whole" } }),
      ]);
      expect(sequences.find((sequence) => sequence.staff === 2)!.content).toEqual([
        expect.objectContaining({ notes: [expect.anything()], duration: { base: "whole" } }),
      ]);
    }
  });

  it("repeats a range containing a tuplet twice using its actual duration and source offset", () => {
    const score = staffScore([1]);
    const triplet: SequenceContent = {
      type: "tuplet",
      inner: { multiple: 3, duration: { base: "eighth" } },
      outer: { multiple: 2, duration: { base: "eighth" } },
      content: ["one", "two", "three"].map((id) => note(id, { base: "eighth" })),
    };
    score.parts[0]!.measures[0]!.sequences[0]!.content = [rest("before", { base: "half" }), note("source"), triplet];
    const selection = buildClipboardSelection(score, {
      kind: "range",
      startElementId: "p0/m0/s0/source",
      endElementId: "p0/m0/s0/three",
    })!;
    expect(selection.cutLocations).toBeUndefined();
    const first = computeRepeatResult(score, selection)!;
    const second = computeRepeatResult(first.newScore, reselect(first))!;

    expect(content(first.newScore)).toEqual(content(score));
    expect(content(second.newScore)).toEqual(content(score));
    expect(content(second.newScore, 0, 1).slice(0, 2)).toEqual(content(first.newScore, 0, 1));
    expect(content(second.newScore, 0, 1).map((item) => item.type)).toEqual(["event", "tuplet", "event", "tuplet"]);
    expect(content(second.newScore, 0, 1).reduce((sum, item) => sum + sequenceContentBeats(item), 0)).toBe(4);
    expect(selectedEvents(second)).toHaveLength(4);
    expect(new Set(scoreIds(second.newScore)).size).toBe(scoreIds(second.newScore).length);
  });

  it("uses the top-level tuplet index from a selected inner event's cut location", () => {
    const score = staffScore([1]);
    const triplet: SequenceContent = {
      type: "tuplet",
      inner: { multiple: 3, duration: { base: "eighth" } },
      outer: { multiple: 2, duration: { base: "eighth" } },
      content: ["one", "two", "three"].map((id) => note(id, { base: "eighth" })),
    };
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      rest("before", { base: "quarter" }),
      triplet,
      rest("after", { base: "half" }),
    ];
    const selection = buildClipboardSelection(score, {
      kind: "single",
      elementId: "p0/m0/s0/three",
      elementType: "event",
    })!;
    expect(selection.cutLocations![0]).toMatchObject({ eventIndex: 2, tupletIndex: 1 });
    const result = computeRepeatResult(score, selection)!;

    expect(content(result.newScore).slice(0, 2)).toEqual(content(score).slice(0, 2));
    expect(content(result.newScore)[2]).toMatchObject({ type: "event", duration: { base: "eighth" }, notes: [{}] });
    expect(result.range!.start).toMatch(/^p0\/m0\/s0\//);
    expect(selectedEvents(result)).toHaveLength(1);
  });

  it("uses actual source duration for multi-selected tuplet notes rather than their nominal sum", () => {
    const score = staffScore([1]);
    const triplet: SequenceContent = {
      type: "tuplet",
      inner: { multiple: 3, duration: { base: "eighth" } },
      outer: { multiple: 2, duration: { base: "eighth" } },
      content: ["one", "two", "three"].map((id) => note(id, { base: "eighth" })),
    };
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      rest("before", { base: "quarter" }),
      triplet,
      note("following", { base: "half" }),
    ];
    const selection = buildClipboardSelection(score, {
      kind: "multi",
      elementIds: ["three", "two", "one"].map((id) => `p0/m0/s0/${id}`),
    })!;
    const result = computeRepeatResult(score, selection)!;
    expect(content(result.newScore).slice(0, 2)).toEqual(content(score).slice(0, 2));
    expect(selectedEvents(result)).toHaveLength(3);
    expect(content(result.newScore)[2]).toMatchObject({ id: selectedEvents(result)[0]!.id });
    expect(
      content(result.newScore)
        .slice(0, 2)
        .reduce((sum, item) => sum + sequenceContentBeats(item), 0),
    ).toBe(2);
  });

  it("keeps the latest source endpoint for sparse multi-voice selections with a nonzero onset", () => {
    const score = staffScore([1, 1]);
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      rest("before-0", { base: "quarter" }),
      note("first"),
      note("gap"),
      note("last"),
    ];
    score.parts[0]!.measures[0]!.sequences[1]!.content = [
      rest("before-1", { base: "quarter" }),
      note("other"),
      rest("after", { base: "half" }),
    ];
    const selection = buildClipboardSelection(score, {
      kind: "multi",
      elementIds: ["p0/m0/s1/other", "p0/m0/s0/last", "p0/m0/s0/first"],
    })!;
    const first = computeRepeatResult(score, selection)!;
    const second = computeRepeatResult(first.newScore, reselect(first))!;
    expect(second.newScore.parts[0]!.measures[0]).toEqual(score.parts[0]!.measures[0]);
    expect(first.range!.start).toMatch(/^p0\/m1\//);
    expect(content(second.newScore, 0, 1).slice(0, 2)).toEqual(content(first.newScore, 0, 1));
    expect(content(second.newScore, 1, 1)[0]).toEqual(content(first.newScore, 1, 1)[0]);
    const selectedIds = new Set(selectedEvents(second).map((event) => event.id));
    for (const sequence of [0, 1]) {
      const placed = content(second.newScore, sequence, 1);
      const index = placed.findIndex((item) => item.type === "event" && selectedIds.has(item.id));
      expect(placed.slice(0, index).reduce((sum, item) => sum + sequenceContentBeats(item), 0)).toBe(2);
    }
  });

  it("retains the primary physical staff when its synthesized rest starts in a later measure", () => {
    const score = staffScore([2]);
    score.parts[0]!.measures[0]!.sequences[0]!.content = [note("lower-0", { base: "whole" })];
    for (let measure = 1; measure < 6; measure++) {
      score.global.measures.push({});
      score.parts[0]!.measures.push({
        sequences: [
          measure === 1
            ? { staff: 1, content: [], fullMeasure: {} }
            : { staff: 1, content: [{ type: "space", duration: [1, 1] }] },
          { staff: 2, content: [note(`lower-${measure}`, { base: "whole" })] },
        ],
      });
    }
    score.parts.push({
      measures: [0, 1, 2, 3, 4, 5].map((measure) => ({
        sequences: [{ content: [note(`unselected-${measure}`, { base: "whole" })] }],
      })),
    });
    let selection = buildClipboardSelection(score, {
      kind: "measure",
      startMeasure: 0,
      endMeasure: 1,
      startPartIndex: 0,
      endPartIndex: 0,
    })!;
    expect(selection.tracks![0]).toMatchObject({ staffOffset: 0, sourceStaff: 1, leadIn: [1024, 1024] });
    let current = score;
    for (let repeat = 1; repeat <= 2; repeat++) {
      const result = computeRepeatResult(current, selection)!;
      const measure = repeat * 2;
      expect(result.newScore.parts[1]).toEqual(score.parts[1]);
      expect(result.newScore.parts[0]!.measures.slice(0, measure)).toEqual(
        current.parts[0]!.measures.slice(0, measure),
      );
      expect(result.newScore.parts[0]!.measures[measure]!.sequences[0]).toEqual(
        current.parts[0]!.measures[measure]!.sequences[0],
      );
      expect(content(result.newScore, 0, measure + 1)).toEqual([
        expect.objectContaining({ rest: expect.anything(), duration: { base: "whole" } }),
      ]);
      expect(selectedEvents(result)).toHaveLength(3);
      current = result.newScore;
      selection = reselect(result);
    }
  });
});
