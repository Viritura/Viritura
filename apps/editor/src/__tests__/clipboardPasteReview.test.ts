import { describe, expect, it } from "vitest";
import {
  measureBeats,
  walkSequenceEvents,
  type ChordSymbol,
  type NoteEvent,
  type NoteValueBase,
  type Score,
  type Sequence,
  type SequenceContent,
  type TimeSignature,
  type Tuplet,
} from "@viritura/core";
import { deserializeFragment } from "../clipboard/deserialize";
import { serializeFragment } from "../clipboard/serialize";
import { applyPaste, pasteResultFromFragment, type PasteResult } from "../commands/clipboardCommands";
import { sequenceContentBeats } from "../commands/noteCommands";

const commonTime: TimeSignature = { count: 4, unit: 4 };

function note(id: string, base: NoteValueBase = "quarter"): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base },
    notes: [{ id: `${id}-note`, pitch: { step: "C", octave: 4 } }],
  };
}

function rest(id: string, base: NoteValueBase = "whole"): NoteEvent {
  return { type: "event", id, duration: { base }, rest: {} };
}

function scoreWithMeters(times: TimeSignature[] = [commonTime]): Score {
  return {
    mnx: { version: 1 },
    global: { measures: times.map((time) => ({ time })) },
    parts: [{ measures: times.map(() => ({ sequences: [{ content: [] }] })) }],
  };
}

function content(score: Score, measureIndex: number, sequenceIndex = 0): SequenceContent[] {
  return score.parts[0]!.measures[measureIndex]!.sequences[sequenceIndex]!.content;
}

function beats(content: SequenceContent[]): number {
  return content.reduce((sum, item) => sum + sequenceContentBeats(item), 0);
}

function events(score: Score): NoteEvent[] {
  return score.parts.flatMap((part) =>
    part.measures.flatMap((measure) =>
      measure.sequences.flatMap((sequence) => [...walkSequenceEvents(sequence.content)].map(({ event }) => event)),
    ),
  );
}

function expectTiedChain(chain: NoteEvent[]): void {
  for (let index = 0; index < chain.length - 1; index++) {
    for (let noteIndex = 0; noteIndex < chain[index]!.notes!.length; noteIndex++) {
      expect(chain[index]!.notes![noteIndex]!.ties).toEqual([{ target: chain[index + 1]!.notes![noteIndex]!.id }]);
    }
  }
}

function tuplet(): Tuplet {
  return {
    type: "tuplet",
    inner: { multiple: 3, duration: { base: "quarter" } },
    outer: { multiple: 2, duration: { base: "quarter" } },
    content: [note("triplet-a"), note("triplet-b"), note("triplet-c")],
  };
}

describe("clipboard cross-bar rhythmic placement review", () => {
  it.each<{ base: NoteValueBase; measures: number }>([
    { base: "breve", measures: 2 },
    { base: "longa", measures: 4 },
  ])("splits a $base into $measures measures with fresh tied continuation IDs", ({ base, measures }) => {
    const score = scoreWithMeters();
    const original = structuredClone(score);
    const source = note("long", base);
    const sourceSnapshot = structuredClone(source);
    const result = applyPaste(score, { content: [source] }, 0, 0, 0, 0);
    const chain = events(result);

    expect(result.global.measures).toHaveLength(measures);
    expect(result.parts[0]!.measures).toHaveLength(measures);
    expect(chain).toHaveLength(measures);
    expect(chain[0]!.id).toBe(source.id);
    expect(chain[0]!.notes![0]!.id).toBe(source.notes![0]!.id);
    for (let index = 0; index < measures; index++) expect(beats(content(result, index))).toBe(4);
    expect(new Set(chain.flatMap((event) => [event.id, event.notes![0]!.id])).size).toBe(measures * 2);
    expectTiedChain(chain);
    expect(chain.at(-1)!.notes![0]!.ties).toBeUndefined();
    expect(score).toEqual(original);
    expect(source).toEqual(sourceSnapshot);
  });

  it("decomposes from a nonzero beat through mixed meters without shifting content", () => {
    const times = [commonTime, { count: 5, unit: 8 }, { count: 3, unit: 4 }, commonTime];
    const score = scoreWithMeters(times);
    content(score, 0).push(note("prefix"), rest("replace", "half"), note("also-replace"));
    const result = applyPaste(score, { content: [note("long", "breve")] }, 0, 0, 0, 1);

    expect(content(result, 0)[0]).toEqual(note("prefix"));
    expect(result.parts[0]!.measures.map((_, index) => beats(content(result, index)))).toEqual([4, 2.5, 2.5, 0]);
    const chain = events(result).filter((event) => event.id !== "prefix");
    expect(chain.map((event) => event.duration)).toEqual([
      { base: "half", dots: 1 },
      { base: "half" },
      { base: "eighth" },
      { base: "half" },
      { base: "eighth" },
    ]);
    expectTiedChain(chain);
    expect(chain.reduce((sum, event) => sum + sequenceContentBeats(event), 0)).toBe(8);
    for (let index = 0; index < times.length; index++) {
      expect(beats(content(result, index))).toBeLessThanOrEqual(measureBeats(times[index]!));
    }
  });

  it("retains incoming targets, outgoing ties on the last chord piece, and onset slurs", () => {
    const score = scoreWithMeters();
    const source = note("chord", "breve");
    source.notes!.push({ id: "chord-e", pitch: { step: "E", octave: 4 }, ties: [{ lv: true }] });
    source.notes![0]!.ties = [{ target: "target-note", side: "down" }];
    source.slurs = [{ target: "target", startNote: "chord-note", endNote: "target-note" }];
    source.markings = { accent: {} };
    source.fermata = {};
    const preceding = note("preceding");
    preceding.notes![0]!.ties = [{ target: "chord-note" }];
    const paste = { content: [preceding, source, note("target")] };
    const snapshot = structuredClone(paste);
    const result = applyPaste(score, paste, 0, 0, 0, 0);
    const placed = events(result);
    const chain = placed.slice(1, -1);

    expect(placed[0]!.notes![0]!.ties).toEqual([{ target: chain[0]!.notes![0]!.id }]);
    expectTiedChain(chain);
    expect(chain.at(-1)!.notes![0]!.ties).toEqual([{ target: "target-note", side: "down" }]);
    expect(chain.at(-1)!.notes![1]!.ties).toEqual([{ lv: true }]);
    expect(chain[0]!.slurs).toEqual(source.slurs);
    expect(chain.slice(1).every((event) => !event.slurs && !event.markings)).toBe(true);
    expect(chain.slice(0, -1).every((event) => !event.fermata)).toBe(true);
    expect(chain.at(-1)!.fermata).toEqual({});
    expect(paste).toEqual(snapshot);
  });

  it("splits a long rest across meters and appends only the measures it needs", () => {
    const times = [
      { count: 3, unit: 4 },
      { count: 5, unit: 8 },
    ];
    const score = scoreWithMeters(times);
    const result = applyPaste(score, { content: [rest("long-rest", "longa")] }, 0, 0, 0, 0);

    expect(result.global.measures).toHaveLength(7);
    expect(result.parts[0]!.measures.map((_, index) => beats(content(result, index)))).toEqual([
      3, 2.5, 2.5, 2.5, 2.5, 2.5, 0.5,
    ]);
    expect(events(result).every((event) => event.rest && !event.notes)).toBe(true);
    expect(events(result).reduce((sum, event) => sum + sequenceContentBeats(event), 0)).toBe(16);
  });

  it("splits rhythmic spaces without turning them into rests", () => {
    const score = scoreWithMeters();
    const result = applyPaste(score, { content: [{ type: "space", duration: [5, 2] }] }, 0, 0, 0, 0);
    expect(result.parts[0]!.measures.map((_, index) => beats(content(result, index)))).toEqual([4, 4, 2]);
    expect(result.parts[0]!.measures.every((measure) => measure.sequences[0]!.content[0]!.type === "space")).toBe(true);
  });

  it("rejects a tuplet at beat three instead of moving it to the next bar, without mutating input", () => {
    const score = scoreWithMeters([commonTime, commonTime]);
    content(score, 0).push(note("one"), note("two"), note("three"), note("four"));
    content(score, 1).push(rest("next-bar"));
    const snapshot = structuredClone(score);
    const paste = { content: [tuplet()] };
    const pasteSnapshot = structuredClone(paste);

    expect(() => applyPaste(score, paste, 0, 0, 0, 3)).toThrow(/tuplet.*barline/);
    expect(score).toEqual(snapshot);
    expect(paste).toEqual(pasteSnapshot);
  });

  it("rejects a tuplet larger than the meter and a later crossing tuplet atomically", () => {
    const shortScore = scoreWithMeters([{ count: 1, unit: 4 }]);
    expect(() => applyPaste(shortScore, { content: [tuplet()] }, 0, 0, 0, 0)).toThrow(/tuplet.*barline/);
    const score = scoreWithMeters();
    const original = structuredClone(score);
    const paste: PasteResult = {
      content: [],
      tracks: [
        { partOffset: 0, staffOffset: 0, voiceIndex: 0, content: [note("valid")] },
        { partOffset: 0, staffOffset: 0, voiceIndex: 1, leadIn: [3, 4], content: [tuplet()] },
      ],
    };
    expect(() => applyPaste(score, paste, 0, 0, 0, 0)).toThrow(/tuplet.*barline/);
    expect(score).toEqual(original);
  });

  it("keeps a fitting tuplet at its nonzero beat", () => {
    const score = scoreWithMeters();
    content(score, 0).push(note("prefix"), note("old-a"), note("old-b"), note("suffix"));
    const result = applyPaste(score, { content: [tuplet()] }, 0, 0, 0, 1);
    expect(content(result, 0)).toEqual([note("prefix"), tuplet(), note("suffix")]);
    expect(result.global.measures).toHaveLength(1);
  });

  it.each([0, -1, Infinity, NaN])("rejects invalid measure capacity %s without looping", (count) => {
    const score = scoreWithMeters([{ count, unit: 4 }]);
    expect(() => applyPaste(score, { content: [note("long", "breve")] }, 0, 0, 0, 0)).toThrow(/invalid duration/);
  });
});

function staffSequence(staff: number, id: string): Sequence {
  return { staff, content: [rest(id)] };
}

describe("clipboard destination staff/voice review", () => {
  it("resolves negative physical-staff offsets into preceding parts", () => {
    const score = scoreWithMeters();
    score.parts.push({ measures: [{ sequences: [{ content: [rest("lower")] }] }] });
    const paste: PasteResult = {
      content: [],
      tracks: [
        { partOffset: 0, staffOffset: 0, voiceIndex: 0, content: [note("lower-paste")] },
        { partOffset: -1, staffOffset: -1, voiceIndex: 0, content: [note("upper-paste")] },
      ],
    };
    const result = applyPaste(score, paste, 1, 0, 0, 0);
    expect(content(result, 0)[0]!.type).toBe("event");
    expect(content(result, 0)[0]).toMatchObject({ id: "upper-paste" });
    expect(result.parts[1]!.measures[0]!.sequences[0]!.content[0]).toMatchObject({ id: "lower-paste" });
  });

  it.each([1, 3])("appends a delayed track starting %s whole notes beyond its anchor", (wholeNotes) => {
    const score = scoreWithMeters();
    content(score, 0).push(note("prefix-a"), note("prefix-b"), note("prefix-c"), note("old"));
    const result = applyPaste(
      score,
      {
        content: [],
        tracks: [
          { partOffset: 0, staffOffset: 0, voiceIndex: 0, content: [note("main")] },
          { partOffset: 0, staffOffset: 0, voiceIndex: 1, leadIn: [wholeNotes, 1], content: [note("delayed")] },
        ],
      },
      0,
      0,
      0,
      3,
    );
    expect(result.global.measures).toHaveLength(wholeNotes + 1);
    expect(content(result, 0).at(-1)).toMatchObject({ id: "main" });
    expect(content(result, wholeNotes, 1)).toEqual([{ type: "space", duration: [3, 4] }, note("delayed")]);
    expect(result.parts[0]!.measures[wholeNotes]!.sequences[1]!.staff).toBe(1);
  });

  it("appends a delayed voice starting exactly at the next barline", () => {
    const score = scoreWithMeters();
    content(score, 0).push(note("prefix-a"), note("prefix-b"), note("prefix-c"), note("old"));
    const result = applyPaste(
      score,
      {
        content: [],
        tracks: [
          { partOffset: 0, staffOffset: 0, voiceIndex: 0, content: [note("main")] },
          { partOffset: 0, staffOffset: 0, voiceIndex: 1, leadIn: [1, 4], content: [note("delayed")] },
        ],
      },
      0,
      0,
      0,
      3,
    );
    expect(result.global.measures).toHaveLength(2);
    expect(content(result, 1, 1)).toEqual([note("delayed")]);
  });

  it.each([false, true])("resolves reordered staff-relative voices in every bar (physical tracks: %s)", (physical) => {
    const score = scoreWithMeters([commonTime, commonTime]);
    score.parts[0]!.staves = 2;
    score.parts[0]!.measures[0]!.sequences = [
      staffSequence(1, "upper-a"),
      staffSequence(2, "lower-a"),
      staffSequence(2, "target-a"),
    ];
    score.parts[0]!.measures[1]!.sequences = [
      staffSequence(2, "lower-b"),
      staffSequence(1, "upper-b"),
      staffSequence(1, "upper-voice2"),
      staffSequence(2, "target-b"),
    ];
    const long = note("long", "breve");
    const paste: PasteResult = physical
      ? { content: [long], tracks: [{ partOffset: 0, staffOffset: 0, voiceIndex: 1, content: [long] }] }
      : { content: [long] };
    const result = applyPaste(score, paste, 0, 0, 2, 0);

    expect(content(result, 0, 0)).toEqual(content(score, 0, 0));
    expect(content(result, 0, 1)).toEqual(content(score, 0, 1));
    for (const index of [0, 1, 2]) expect(content(result, 1, index)).toEqual(content(score, 1, index));
    expect(content(result, 0, 2)[0]).toMatchObject({ id: "long", duration: { base: "whole" } });
    expect(content(result, 1, 3)[0]).toMatchObject({
      duration: { base: "whole" },
      notes: [{ pitch: long.notes![0]!.pitch }],
    });
    expectTiedChain([content(result, 0, 2)[0] as NoteEvent, content(result, 1, 3)[0] as NoteEvent]);
  });

  it("creates staff 2 in a staff-1-only following measure without corrupting either upper voice", () => {
    const score = scoreWithMeters([commonTime, commonTime]);
    score.parts[0]!.staves = 2;
    score.parts[0]!.measures[0]!.sequences = [staffSequence(2, "lower"), staffSequence(1, "upper")];
    score.parts[0]!.measures[1]!.sequences = [staffSequence(1, "upper-a"), staffSequence(1, "upper-b")];
    const result = applyPaste(
      score,
      {
        content: [],
        tracks: [{ partOffset: 0, staffOffset: 0, voiceIndex: 0, content: [note("long", "breve")] }],
      },
      0,
      0,
      0,
      0,
    );

    expect(content(result, 0, 1)).toEqual(content(score, 0, 1));
    expect(result.parts[0]!.measures[1]!.sequences.slice(0, 2)).toEqual(score.parts[0]!.measures[1]!.sequences);
    expect(result.parts[0]!.measures[1]!.sequences[2]).toMatchObject({
      staff: 2,
      content: [{ type: "event", duration: { base: "whole" } }],
    });
    expectTiedChain([content(result, 0)[0] as NoteEvent, content(result, 1, 2)[0] as NoteEvent]);
  });

  it("marks a newly appended lower staff and preserves an independent upper voice", () => {
    const score = scoreWithMeters();
    score.parts[0]!.staves = 2;
    score.parts[0]!.measures[0]!.sequences = [staffSequence(1, "upper"), staffSequence(2, "lower")];
    const result = applyPaste(score, { content: [note("long", "breve")] }, 0, 0, 1, 0);
    expect(content(result, 0, 0)).toEqual(content(score, 0, 0));
    expect(result.parts[0]!.measures[1]!.sequences).toHaveLength(2);
    expect(result.parts[0]!.measures[1]!.sequences[1]!.staff).toBe(2);
    expect(content(result, 1, 0)).toEqual([]);
  });

  it("uses pasted primary IDs from the actual track and preserves cross-staff connectors", () => {
    const score = scoreWithMeters();
    score.parts[0]!.staves = 2;
    const upper = note("upper-source");
    const lower = note("lower-source");
    upper.slurs = [{ target: lower.id!, startNote: upper.notes![0]!.id, endNote: lower.notes![0]!.id }];
    upper.notes![0]!.ties = [{ target: lower.notes![0]!.id }];
    const tracks = [
      { partOffset: 0, staffOffset: 0, voiceIndex: 0, content: [upper] },
      { partOffset: 0, staffOffset: 1, voiceIndex: 0, content: [lower] },
    ];
    const fragment = deserializeFragment(serializeFragment([lower], commonTime, { fifths: 0 }, tracks))!;
    const paste = pasteResultFromFragment(fragment);
    const result = applyPaste(score, paste, 0, 0, 0, 0);
    const placedUpper = content(result, 0, 0)[0] as NoteEvent;
    const placedLower = content(result, 0, 1)[0] as NoteEvent;
    expect(paste.content).toBe(paste.tracks![1]!.content);
    expect(paste.content[0]).toEqual(placedLower);
    expect(placedUpper.slurs).toEqual([
      {
        target: placedLower.id,
        startNote: placedUpper.notes![0]!.id,
        endNote: placedLower.notes![0]!.id,
      },
    ]);
    expect(placedUpper.notes![0]!.ties).toEqual([{ target: placedLower.notes![0]!.id }]);
    expect(result.parts[0]!.measures[0]!.sequences[1]!.staff).toBe(2);
  });
});

describe("clipboard chord-symbol identity review", () => {
  it.each([undefined, 1])("preserves staff 1 (%s) harmony when replacing staff 2 at the same beat", (displayStaff) => {
    const score = scoreWithMeters();
    const upper: ChordSymbol = {
      position: { fraction: [1, 4] },
      displayStaff,
      root: { step: "C" },
      quality: "major",
    };
    const lower: ChordSymbol = {
      position: { fraction: [2, 8] },
      displayStaff: 2,
      root: { step: "D" },
      quality: "minor",
    };
    score.parts[0]!.measures[0]!.chordSymbols = [upper, lower];
    const replacement: ChordSymbol = { ...lower, root: { step: "E" } };
    const result = applyPaste(
      score,
      {
        content: [],
        chordSymbols: [{ measureOffset: 0, chordSymbol: replacement }],
      },
      0,
      0,
      0,
      0,
    );

    expect(result.parts[0]!.measures[0]!.chordSymbols).toEqual([
      upper,
      { ...replacement, position: { fraction: [1, 4] } },
    ]);
    expect(score.parts[0]!.measures[0]!.chordSymbols).toEqual([upper, lower]);
  });

  it("treats omitted displayStaff and explicit staff 1 as the same identity", () => {
    const score = scoreWithMeters();
    const original: ChordSymbol = {
      position: { fraction: [0, 1] },
      displayStaff: 1,
      root: { step: "C" },
      quality: "major",
    };
    score.parts[0]!.measures[0]!.chordSymbols = [original];
    const result = applyPaste(
      score,
      {
        content: [],
        chordSymbols: [{ measureOffset: 0, chordSymbol: { ...original, displayStaff: undefined, quality: "minor" } }],
      },
      0,
      0,
      0,
      0,
    );
    expect(result.parts[0]!.measures[0]!.chordSymbols).toHaveLength(1);
    expect(result.parts[0]!.measures[0]!.chordSymbols![0]!.quality).toBe("minor");
  });
});
