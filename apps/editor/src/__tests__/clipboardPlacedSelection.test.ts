import { describe, expect, it } from "vitest";
import { walkSequenceEvents, type NoteEvent, type Score, type SequenceContent, type Tuplet } from "@viritura/core";
import { computePasteResult, findPastedSelection } from "../clipboard/computePasteResult";
import { pasteTrackIntoScore } from "../clipboard/pasteContent";
import type { PasteResult } from "../commands/clipboardCommands";
import { sequenceContentBeats } from "../commands/noteCommands";
import { resolveGraceLocation } from "../score/ElementPath";
import { resolveRangeElementIds } from "../store/selectionUtils";

function note(id: string, base: NoteEvent["duration"]["base"] = "quarter"): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base },
    notes: [{ id: `${id}-note`, pitch: { step: "C", octave: 4 } }],
  };
}

function rest(id: string, base: NoteEvent["duration"]["base"] = "whole"): NoteEvent {
  return { type: "event", id, duration: { base }, rest: {} };
}

function kit(id: string, base: NoteEvent["duration"]["base"] = "quarter"): NoteEvent {
  return { type: "event", id, duration: { base }, kitNotes: [{ id: `${id}-snare`, kitComponent: "snare" }] };
}

function scoreWithRests(measures = 1, parts = 1): Score {
  return {
    mnx: { version: 1 },
    global: { measures: Array.from({ length: measures }, () => ({ time: { count: 4, unit: 4 } })) },
    parts: Array.from({ length: parts }, (_, part) => ({
      measures: Array.from({ length: measures }, (_, measure) => ({
        sequences: [{ content: [rest(`old-${part}-${measure}`)] }],
      })),
    })),
  };
}

function pasteAt(score: Score, paste: PasteResult, elementId = "p0/m0/s0/old-0-0") {
  return computePasteResult(score, { kind: "single", elementId, elementType: "event" }, paste)!;
}

function content(score: Score, measure = 0, sequence = 0, part = 0): SequenceContent[] {
  return score.parts[part]!.measures[measure]!.sequences[sequence]!.content;
}

function selectedIds(result: NonNullable<ReturnType<typeof computePasteResult>>): string[] {
  expect(result.range).not.toBeNull();
  return resolveRangeElementIds(result.range!.start, result.range!.end, result.newScore);
}

function tuplet(children: SequenceContent[]): Tuplet {
  return {
    type: "tuplet",
    inner: { multiple: 3, duration: { base: "quarter" } },
    outer: { multiple: 2, duration: { base: "quarter" } },
    content: children,
  };
}

describe("selection of actual clipboard placement", () => {
  it.each([
    { label: "pitched note", create: note },
    { label: "rest", create: rest },
    { label: "kit note", create: kit },
  ])("selects the full breve $label including its generated continuation", ({ create }) => {
    const score = scoreWithRests(2);
    const source = create("pasted-breve", "breve");
    const snapshot = structuredClone({ score, source });
    const result = pasteAt(score, { content: [source] });
    const continuation = content(result.newScore, 1)[0] as NoteEvent;

    expect(continuation.id).toBeTruthy();
    expect(continuation.id).not.toBe(source.id);
    expect(result.range).toEqual({
      start: "p0/m0/s0/pasted-breve",
      end: `p0/m1/s0/${continuation.id}`,
    });
    expect(selectedIds(result)).toEqual([result.range!.start, result.range!.end]);
    expect({ score, source }).toEqual(snapshot);
  });

  it.each(["single", "physical", "legacy"] as const)(
    "follows the actual sequence of two whole notes across reordered staves/voices (%s)",
    (mode) => {
      const score = scoreWithRests(2);
      score.parts[0]!.staves = 2;
      score.parts[0]!.measures[0]!.sequences = [1, 1, 2, 2].map((staff, index) => ({
        staff,
        content: [rest(`first-${index}`)],
      }));
      score.parts[0]!.measures[1]!.sequences = [2, 1, 2, 1].map((staff, index) => ({
        staff,
        content: [rest(`second-${index}`)],
      }));
      const events = [note("whole-one", "whole"), note("whole-two", "whole")];
      const paste: PasteResult = { content: events };
      if (mode !== "single") {
        paste.tracks = [
          {
            partOffset: 0,
            voiceIndex: mode === "physical" ? 1 : 3,
            ...(mode === "physical" ? { staffOffset: 0 } : {}),
            content: events,
          },
        ];
      }
      const result = pasteAt(score, paste, "p0/m0/s3/first-3");

      expect(result.range).toEqual({ start: "p0/m0/s3/whole-one", end: "p0/m1/s2/whole-two" });
      expect(content(result.newScore, 0, 3)).toEqual([events[0]]);
      expect(content(result.newScore, 1, 2)).toEqual([events[1]]);
      expect(content(result.newScore, 1, 3)).toEqual([rest("second-3")]);
    },
  );

  it.each([
    { mode: "physical", differentIds: false },
    { mode: "legacy", differentIds: false },
    { mode: "physical", differentIds: true },
    { mode: "legacy", differentIds: true },
  ])(
    "uses authoritative $mode tracks when primary is not first (different IDs: $differentIds)",
    ({ mode, differentIds }) => {
      const score = scoreWithRests(1, 2);
      const primary = [note("actual-primary")];
      const result = pasteAt(score, {
        content: differentIds ? [note("unused-primary-copy")] : primary,
        tracks: [
          {
            partOffset: 1,
            voiceIndex: 0,
            ...(mode === "physical" ? { staffOffset: 1 } : {}),
            content: [note("actual-other")],
          },
          {
            partOffset: 0,
            voiceIndex: 0,
            ...(mode === "physical" ? { staffOffset: 0 } : {}),
            content: primary,
          },
        ],
      });

      expect(result.range).toEqual({ start: "p0/m0/s0/actual-primary", end: "p1/m0/s0/actual-other" });
      expect(selectedIds(result)).toEqual(["p0/m0/s0/actual-primary", "p1/m0/s0/actual-other"]);
      expect(content(result.newScore, 0, 0, 0)).toHaveLength(2);
      expect(content(result.newScore, 0, 0, 1)).toHaveLength(2);
    },
  );

  it("orders simultaneous tracks by physical staff rather than sequence index or clipboard order", () => {
    const score = scoreWithRests();
    score.parts[0]!.staves = 2;
    score.parts[0]!.measures[0]!.sequences = [
      { staff: 2, content: [rest("lower-old")] },
      { staff: 1, content: [rest("upper-old")] },
    ];
    const result = pasteAt(
      score,
      {
        content: [],
        tracks: [
          { partOffset: 0, staffOffset: 1, voiceIndex: 0, content: [note("lower")] },
          { partOffset: 0, staffOffset: 0, voiceIndex: 0, content: [note("upper")] },
        ],
      },
      "p0/m0/s1/upper-old",
    );

    expect(result.range).toEqual({ start: "p0/m0/s1/upper", end: "p0/m0/s0/lower" });
    expect(selectedIds(result).sort()).toEqual(["p0/m0/s0/lower", "p0/m0/s1/upper"]);
  });

  it.each([false, true])("includes a sustained lower track with fewer onsets (separate parts: %s)", (separateParts) => {
    const score = scoreWithRests(1, separateParts ? 2 : 1);
    if (!separateParts) {
      score.parts[0]!.staves = 2;
      score.parts[0]!.measures[0]!.sequences = [
        { staff: 1, content: [rest("old-0-0")] },
        { staff: 2, content: [rest("old-lower")] },
      ];
    }
    const quarters = [0, 1, 2, 3].map((index) => note(`upper-${index}`));
    const result = pasteAt(score, {
      content: quarters,
      tracks: [
        { partOffset: 0, staffOffset: 0, voiceIndex: 0, content: quarters },
        { partOffset: separateParts ? 1 : 0, staffOffset: 1, voiceIndex: 0, content: [note("lower", "whole")] },
      ],
    });
    expect(selectedIds(result).sort()).toEqual(
      [...quarters.map((event) => `p0/m0/s0/${event.id}`), separateParts ? "p1/m0/s0/lower" : "p0/m0/s1/lower"].sort(),
    );
  });

  it.each(["physical", "legacy"] as const)(
    "selects split continuations on every %s track, not final remainder rests",
    (mode) => {
      const score = scoreWithRests(3, 2);
      const result = pasteAt(score, {
        content: [note("unused-copy", "breve")],
        tracks: [1, 0].map((partOffset) => ({
          partOffset,
          voiceIndex: 0,
          ...(mode === "physical" ? { staffOffset: partOffset } : {}),
          content: [note(`long-${partOffset}`, "breve"), note(`last-${partOffset}`)],
        })),
      });

      expect(result.range).toEqual({ start: "p0/m0/s0/long-0", end: "p1/m2/s0/last-1" });
      expect(selectedIds(result)).toHaveLength(6);
      for (const partIndex of [0, 1]) {
        const continuation = content(result.newScore, 1, 0, partIndex)[0] as NoteEvent;
        expect(selectedIds(result)).toContain(`p${partIndex}/m1/s0/${continuation.id}`);
        const remainder = content(result.newScore, 2, 0, partIndex)[1] as NoteEvent;
        expect(remainder.rest).toEqual({});
        expect(selectedIds(result)).not.toContain(`p${partIndex}/m2/s0/${remainder.id}`);
      }
    },
  );

  it("includes a track on a part above the paste anchor", () => {
    const score = scoreWithRests(1, 2);
    const result = pasteAt(
      score,
      {
        content: [note("lower")],
        tracks: [
          { partOffset: 0, staffOffset: 0, voiceIndex: 0, content: [note("lower")] },
          { partOffset: -1, staffOffset: -1, voiceIndex: 0, content: [note("upper")] },
        ],
      },
      "p1/m0/s0/old-1-0",
    );

    expect(result.range).toEqual({ start: "p0/m0/s0/upper", end: "p1/m0/s0/lower" });
    expect(selectedIds(result)).toEqual(["p0/m0/s0/upper", "p1/m0/s0/lower"]);
  });

  it("orders different track offsets chronologically, not part-first", () => {
    const score = scoreWithRests(2, 2);
    const result = pasteAt(score, {
      content: [],
      tracks: [
        { partOffset: 0, staffOffset: 0, voiceIndex: 0, leadIn: [1, 1], content: [note("later-upper")] },
        { partOffset: 1, staffOffset: 1, voiceIndex: 0, content: [note("earlier-lower")] },
      ],
    });

    expect(result.range).toEqual({ start: "p1/m0/s0/earlier-lower", end: "p0/m1/s0/later-upper" });
  });

  it.each(["note", "rest"] as const)("does not select destination remainder rests after a pasted %s", (kind) => {
    const score = scoreWithRests();
    const pasted = kind === "rest" ? rest("pasted", "quarter") : note("pasted");
    const result = pasteAt(score, { content: [pasted] });
    const placed = content(result.newScore);

    expect(result.range).toEqual({ start: "p0/m0/s0/pasted", end: "p0/m0/s0/pasted" });
    expect(selectedIds(result)).toEqual(["p0/m0/s0/pasted"]);
    expect(placed[0]).toEqual(pasted);
    expect(placed[1]).toMatchObject({ rest: {}, duration: { base: "half", dots: 1 } });
  });

  it("retains a pasted rest between destination rests without merging away its ID", () => {
    const score = scoreWithRests();
    content(score).splice(0, 1, rest("before", "quarter"), rest("replace", "half"), rest("after", "quarter"));
    const result = pasteAt(score, { content: [rest("pasted", "quarter")] }, "p0/m0/s0/replace");

    expect(result.range).toEqual({ start: "p0/m0/s0/pasted", end: "p0/m0/s0/pasted" });
    expect(selectedIds(result)).toEqual(["p0/m0/s0/pasted"]);
    expect(content(result.newScore).map(sequenceContentBeats)).toEqual([1, 1, 2]);
    expect(content(result.newScore)[0]).toEqual(rest("before", "quarter"));
  });

  it("selects the surviving ID when adjacent pasted rests merge", () => {
    const result = pasteAt(scoreWithRests(), { content: [rest("first", "quarter"), rest("second", "quarter")] });

    expect(result.range).toEqual({ start: "p0/m0/s0/first", end: "p0/m0/s0/first" });
    expect(selectedIds(result)).toEqual(["p0/m0/s0/first"]);
    expect(content(result.newScore)[0]).toEqual(rest("first", "half"));
    expect(content(result.newScore)[1]).toMatchObject({ rest: {}, duration: { base: "half" } });
  });

  it("selects kit events in tuplets and tremolos without flattening the placed containers", () => {
    const source: SequenceContent[] = [
      tuplet([kit("triplet-first"), kit("triplet-middle"), kit("triplet-last")]),
      {
        type: "tremolo",
        marks: 3,
        outer: { multiple: 1, duration: { base: "half" } },
        content: [kit("tremolo-first"), kit("tremolo-last")],
      },
    ];
    const snapshot = structuredClone(source);
    const result = pasteAt(scoreWithRests(), { content: source });

    expect(result.range).toEqual({ start: "p0/m0/s0/triplet-first", end: "p0/m0/s0/tremolo-last" });
    expect(content(result.newScore)).toEqual(snapshot);
    expect(source).toEqual(snapshot);
    expect(selectedIds(result)).toHaveLength(5);
  });

  it("finds recursively nested event IDs while keeping the legacy finder signature", () => {
    const source = [tuplet([tuplet([kit("nested-first"), kit("nested-middle"), kit("nested-last")]), note("last")])];
    const score = scoreWithRests();
    const placed = pasteTrackIntoScore(score, 0, 0, 0, 0, source);

    expect(findPastedSelection(score, placed, 0, 0, 0)).toEqual({
      start: "p0/m0/s0/nested-first",
      end: "p0/m0/s0/last",
    });
    expect(content(score)[0]).toEqual(source[0]);
    expect(content(score)[0]).not.toBe(source[0]);
  });

  it("keeps simultaneous tuplet endpoints on their physical range corners despite rounding", () => {
    const score = scoreWithRests(1, 2);
    const placed: SequenceContent[] = [];
    for (const partIndex of [0, 1]) {
      content(score, 0, 0, partIndex).splice(0, 1, note(`prefix-${partIndex}`, "half"), rest("replace", "half"));
      const triplet: Tuplet = {
        type: "tuplet",
        inner: { multiple: 3, duration: { base: "eighth" } },
        outer: { multiple: 2, duration: { base: "eighth" } },
        content:
          partIndex === 0
            ? [note("upper-first", "eighth"), note("upper-middle", "eighth"), note("upper-last", "eighth")]
            : [note("lower-first"), note("lower-last", "eighth")],
      };
      placed.push(...pasteTrackIntoScore(score, partIndex, 0, 0, 1, [triplet]));
    }
    const range = findPastedSelection(score, placed, 0, 0, 0)!;

    expect(range).toEqual({ start: "p0/m0/s0/upper-first", end: "p1/m0/s0/lower-last" });
    expect(resolveRangeElementIds(range.start, range.end, score)).toHaveLength(5);
  });

  it.each([false, true])("uses actual grace paths for placed kit notes (trailing: %s)", (trailing) => {
    const score = scoreWithRests();
    content(score).splice(0);
    const grace: SequenceContent = { type: "grace", content: [kit("grace-first"), kit("grace-last")] };
    const principal = kit("principal", "half");
    const source = trailing ? [principal, grace] : [grace, principal];
    const placed = pasteTrackIntoScore(score, 0, 0, 0, 0, source);
    const range = findPastedSelection(score, placed, 0, 0, 0)!;
    const graceEndpoint = trailing ? range.end : range.start;

    expect(range).toEqual({
      start: trailing ? "p0/m0/s0/principal" : "p0/m0/s0/principal/grace/grace-first",
      end: trailing ? "p0/m0/s0/principal/grace/grace-last" : "p0/m0/s0/principal",
    });
    expect(resolveGraceLocation(graceEndpoint, score)).not.toBeNull();
    expect(content(score)).toEqual(source);
  });

  it("does not select anything for empty or skipped track placement", () => {
    const score = scoreWithRests();
    const result = pasteAt(score, {
      content: [note("unused")],
      tracks: [{ partOffset: 5, voiceIndex: 0, content: [note("skipped")] }],
    });
    expect(result.range).toBeNull();
    expect(result.newScore).toEqual(score);
    expect(findPastedSelection(score, [], 0, 0, 0)).toBeNull();
  });
});

describe("pasteTrackIntoScore placed-content contract", () => {
  it("returns actual fragments including fresh continuations but not clearing remainders", () => {
    const score = scoreWithRests(3);
    const placed = pasteTrackIntoScore(score, 0, 0, 0, 0, [note("breve", "breve"), note("quarter")]);
    const ids = [...walkSequenceEvents(placed)].map(({ event }) => event.id);

    expect(placed).toHaveLength(3);
    expect(ids[0]).toBe("breve");
    expect(ids[1]).not.toBe("breve");
    expect(ids[2]).toBe("quarter");
    for (let measure = 0; measure < 3; measure++) expect(placed[measure]).toBe(content(score, measure)[0]);
    expect(content(score, 2)).toHaveLength(2);
    expect(placed).not.toContain(content(score, 2)[1]);
  });

  it("returns only surviving pasted rests after merging within the pasted interval", () => {
    const score = scoreWithRests();
    const placed = pasteTrackIntoScore(score, 0, 0, 0, 0, [rest("first", "quarter"), rest("second", "quarter")]);

    expect(placed).toEqual([rest("first", "half")]);
    expect(placed[0]).toBe(content(score)[0]);
    expect(content(score)).toHaveLength(2);
  });

  it.each([
    { part: 2, measure: 0, sequence: 0, events: [note("unused")] },
    { part: 0, measure: 2, sequence: 0, events: [note("unused")] },
    { part: 0, measure: 0, sequence: 2, events: [note("unused")] },
    { part: 0, measure: 0, sequence: 0, events: [] },
  ])(
    "returns an empty collector for an unavailable target or empty content: %j",
    ({ part, measure, sequence, events }) => {
      const score = scoreWithRests();
      const snapshot = structuredClone(score);
      expect(pasteTrackIntoScore(score, part, measure, sequence, 0, events)).toEqual([]);
      expect(score).toEqual(snapshot);
    },
  );
});
