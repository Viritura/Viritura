import { describe, expect, it } from "vitest";
import {
  CHORDS_PART_ID,
  parseChordSymbolText,
  voiceChordSymbol,
  type ChordSymbol,
  type GlobalMeasure,
  type NoteEvent,
  type Score,
} from "@viritura/core";
import { generatePerformanceEvents, generateTimeline, getChordPlaybackPart, type TimelineOptions } from "../index";

function chord(fields: Omit<ChordSymbol, "position">, beat = 0): ChordSymbol {
  return { ...fields, position: { fraction: [beat, 4] } };
}

function major(step: string, beat = 0): ChordSymbol {
  return chord({ root: { step } }, beat);
}

function makeScore(measures: GlobalMeasure[]): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: measures.map((measure, index) => ({
        id: `m${index}`,
        ...(index === 0
          ? { time: { count: 4, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" as const } }] }
          : {}),
        ...measure,
      })),
    },
    parts: [{ id: "piano", name: "Piano", measures: measures.map(() => ({ sequences: [{ content: [] }] })) }],
  };
}

function pitches(symbol: ChordSymbol): number[] {
  const voicing = voiceChordSymbol(symbol);
  return [...voicing.leftHand, ...voicing.rightHand];
}

interface ChordSpan {
  symbol: ChordSymbol;
  start: number;
  end: number;
}

/** Check both playback backends against the same independent harmony schedule. */
function expectSpans(score: Score, spans: ChordSpan[], options?: TimelineOptions): void {
  const timeline = generateTimeline(score, options);
  const midi = timeline.events.filter(
    (event) => event.playbackLaneId === CHORDS_PART_ID && (event.type === "noteOn" || event.type === "noteOff"),
  );
  const performance = generatePerformanceEvents(score, score.parts.length, options);
  const ons = performance.filter((event) => event.kind === "noteOn");
  const offs = performance.filter((event) => event.kind === "noteOff");
  const expected = spans.flatMap((span) => pitches(span.symbol).map((pitch) => ({ ...span, pitch })));
  const compare = (a: { time: number; pitch: number }, b: { time: number; pitch: number }) =>
    a.time - b.time || a.pitch - b.pitch;

  expect(ons).toHaveLength(expected.length);
  expect(offs).toHaveLength(expected.length);
  expect(midi).toHaveLength(expected.length * 2);
  expect(midi.every((event) => event.partIndex === score.parts.length)).toBe(true);
  expect(new Set(ons.map((event) => event.note.id)).size).toBe(ons.length);
  expect(performance.map((event) => event.time)).toEqual(performance.map((event) => event.time).sort((a, b) => a - b));
  if (expected.length > 0) expect(performance[0]).toEqual({ kind: "reset", time: 0 });

  for (const [kind, boundary] of [
    ["noteOn", "start"],
    ["noteOff", "end"],
  ] as const) {
    const expectedNotes = expected.map((note) => ({ time: note[boundary], pitch: note.pitch })).sort(compare);
    const browserNotes = midi
      .filter((event) => event.type === kind)
      .map((event) => ({ time: event.time, pitch: event.midiNote }))
      .sort(compare);
    const nativeNotes = (kind === "noteOn" ? ons : offs)
      .map((event) => ({ time: event.time, pitch: event.note.pitch }))
      .sort(compare);
    for (const actual of [browserNotes, nativeNotes]) {
      expect(actual).toHaveLength(expectedNotes.length);
      actual.forEach((note, index) => {
        expect(note.pitch).toBe(expectedNotes[index]!.pitch);
        expect(note.time).toBeCloseTo(expectedNotes[index]!.time, 10);
      });
    }
  }

  for (const onset of ons) {
    const releases = offs.filter((event) => event.note.id === onset.note.id);
    expect(releases).toHaveLength(1);
    expect(releases[0]!.note.pitch).toBe(onset.note.pitch);
    expect(onset.note.startTime).toBe(onset.time);
    expect(releases[0]!.time).toBeCloseTo(onset.time + onset.note.duration, 10);
    expect(onset.note.duration).toBeGreaterThan(0);
  }
}

describe("derived global chord playback", () => {
  const modifierPitches: { text: string; notes: number[] }[] = [
    { text: "Cadd6", notes: [36, 60, 64, 67, 69] },
    { text: "C6", notes: [36, 60, 64, 67, 69] },
    { text: "Csus47", notes: [36, 60, 65, 67, 70] },
    { text: "C7sus4", notes: [36, 60, 65, 67, 70] },
    { text: "Cadd79omit5/E", notes: [40, 60, 62, 64, 70] },
    { text: "C(add7,9,no5)/E", notes: [40, 60, 62, 64, 70] },
    { text: "Cadd(7,9)omit5/E", notes: [40, 60, 62, 64, 70] },
    { text: "C7(add9,omit5)", notes: [36, 60, 62, 64, 70] },
    { text: "Cmaj7add9", notes: [36, 60, 62, 64, 67, 71] },
    { text: "Cadd791113", notes: [36, 60, 62, 64, 65, 67, 69, 70] },
    { text: "Cno(3,5)", notes: [36, 60] },
    { text: "Comit(3,5)", notes: [36, 60] },
    { text: "Cadd2", notes: [36, 60, 62, 64, 67] },
    { text: "Cadd4", notes: [36, 60, 64, 65, 67] },
    { text: "Cadd7", notes: [36, 60, 64, 67, 70] },
    { text: "Cmajadd7", notes: [36, 60, 64, 67, 70] },
    { text: "Cmadd7", notes: [36, 60, 63, 67, 70] },
    { text: "Cdimadd7", notes: [36, 60, 63, 66, 70] },
    { text: "Cadd9", notes: [36, 60, 62, 64, 67] },
    { text: "Cadd11", notes: [36, 60, 64, 65, 67] },
    { text: "Cadd13", notes: [36, 60, 64, 67, 69] },
    ...["no", "omit"].flatMap((modifier) => [
      { text: `C${modifier}1`, notes: [36, 64, 67] },
      { text: `Csus2${modifier}2`, notes: [36, 60, 67] },
      { text: `C${modifier}3`, notes: [36, 60, 67] },
      { text: `Csus4${modifier}4`, notes: [36, 60, 67] },
      { text: `C${modifier}5`, notes: [36, 60, 64] },
      { text: `C6${modifier}6`, notes: [36, 60, 64, 67] },
      { text: `C7${modifier}7`, notes: [36, 60, 64, 67] },
      { text: `C9${modifier}9`, notes: [36, 60, 64, 67, 70] },
      { text: `C11${modifier}11`, notes: [36, 60, 62, 64, 67, 70] },
      { text: `C13${modifier}13`, notes: [36, 60, 62, 64, 65, 67, 70] },
    ]),
  ];

  it.each(modifierPitches)("plays $text with independent numeric MIDI and performance pitches", ({ text, notes }) => {
    for (const symbol of [parseChordSymbolText(text, { fraction: [0, 1] }), chord({ rawText: text })]) {
      const score = makeScore([{ chordSymbols: [symbol] }]);
      const midi = generateTimeline(score).events.filter((event) => event.playbackLaneId === CHORDS_PART_ID);
      const performance = generatePerformanceEvents(score, score.parts.length);
      for (const [kind, time] of [
        ["noteOn", 0],
        ["noteOff", 2],
      ] as const) {
        const expected = notes.map((pitch) => ({ pitch, time }));
        expect(
          midi
            .filter((event) => event.type === kind)
            .map((event) => ({ pitch: event.midiNote, time: event.time }))
            .sort((a, b) => a.pitch - b.pitch),
        ).toEqual(expected);
        expect(
          performance
            .filter((event) => event.kind === kind)
            .map((event) => ({ pitch: event.note.pitch, time: event.time }))
            .sort((a, b) => a.pitch - b.pitch),
        ).toEqual(expected);
      }
    }
  });

  const supported: { name: string; symbol: ChordSymbol; notes: number[] }[] = [
    { name: "implicit major", symbol: major("C"), notes: [36, 60, 64, 67] },
    { name: "minor", symbol: chord({ root: { step: "D" }, quality: "minor" }), notes: [38, 62, 65, 69] },
    {
      name: "dominant thirteenth",
      symbol: chord({ root: { step: "C" }, quality: "dominant", extension: 13 }),
      notes: [36, 60, 62, 64, 65, 67, 69, 70],
    },
    {
      name: "minor-major ninth",
      symbol: chord({ root: { step: "C" }, quality: "minor-major", extension: 9 }),
      notes: [36, 60, 62, 63, 67, 71],
    },
    {
      name: "half-diminished",
      symbol: chord({ root: { step: "B" }, quality: "half-diminished" }),
      notes: [47, 62, 65, 69, 71],
    },
    {
      name: "diminished seventh",
      symbol: chord({ root: { step: "C" }, quality: "diminished", extension: 7 }),
      notes: [36, 60, 63, 66, 69],
    },
    { name: "suspended", symbol: chord({ root: { step: "G" }, quality: "suspended4" }), notes: [43, 60, 62, 67] },
    {
      name: "altered root and non-chord slash bass",
      symbol: chord({ root: { step: "B", alter: -1 }, bass: { step: "E" } }),
      notes: [40, 62, 65, 70],
    },
    { name: "raw slash chord", symbol: chord({ rawText: "Cmaj7/E" }), notes: [40, 60, 64, 67, 71] },
  ];

  it.each(supported)("uses core voicing for $name with exact simultaneous attacks", ({ symbol, notes }) => {
    const score = makeScore([{ chordSymbols: [symbol] }]);
    expect(pitches(symbol)).toEqual(notes);
    expectSpans(score, [{ symbol, start: 0, end: 2 }]);
    const events = generateTimeline(score).events.filter((event) => event.playbackLaneId === CHORDS_PART_ID);
    expect(new Set(events.filter((event) => event.type === "noteOn").map((event) => event.time))).toEqual(new Set([0]));
    expect(new Set(events.filter((event) => event.type === "noteOff").map((event) => event.time))).toEqual(
      new Set([2]),
    );
    const native = generatePerformanceEvents(score, score.parts.length);
    expect(new Set(native.filter((event) => event.kind === "noteOn").map((event) => event.time))).toEqual(new Set([0]));
    expect(new Set(native.filter((event) => event.kind === "noteOff").map((event) => event.time))).toEqual(
      new Set([2]),
    );
    expect(notes.filter((pitch) => pitch >= 36 && pitch <= 47)).toHaveLength(1);
    expect(notes.slice(1).every((pitch) => pitch >= 60 && pitch <= 71)).toBe(true);
  });

  const silent: { name: string; symbol: ChordSymbol }[] = [
    { name: "NC", symbol: chord({ rawText: "NC" }) },
    { name: "unsupported text", symbol: chord({ rawText: "C7alt" }) },
    { name: "unsupported quality", symbol: chord({ root: { step: "C" }, quality: "other" }) },
    { name: "missing root", symbol: chord({ quality: "major" }) },
    { name: "contradictory display override", symbol: chord({ root: { step: "C" }, textOverride: "Dm" }) },
    { name: "fractional alteration", symbol: chord({ root: { step: "C", alter: 0.5 } }) },
  ];

  it.each(silent)("retains a lane but emits no notes for $name", ({ symbol }) => {
    const score = makeScore([{}, { chordSymbols: [symbol] }]);
    expect(getChordPlaybackPart(score)).toEqual({ id: CHORDS_PART_ID, partIndex: 1, name: "Chords" });
    expectSpans(score, []);
  });

  it("finds symbols even in a measure skipped by playback", () => {
    const score = makeScore([
      { fine: { location: { fraction: [1, 1] } }, segno: { location: { fraction: [0, 1] } } },
      { jump: { type: "dsalfine", location: { fraction: [1, 1] } } },
      { chordSymbols: [major("C")] },
    ]);
    expect(generateTimeline(score).expandedMeasureToOriginal).toEqual([0, 1, 0]);
    expect(getChordPlaybackPart(score)).toEqual({ id: CHORDS_PART_ID, partIndex: 1, name: "Chords" });
    expectSpans(score, []);
  });

  it("ignores legacy part-local symbols and has no lane without global symbols", () => {
    const score = makeScore([{}]);
    const legacyMeasure = { ...score.parts[0]!.measures[0]!, chordSymbols: [major("D")] };
    score.parts[0]!.measures[0] = legacyMeasure;
    expect(getChordPlaybackPart(score)).toBeUndefined();
    expectSpans(score, []);
    const symbol = major("C");
    score.global.measures[0]!.chordSymbols = [symbol];
    expectSpans(score, [{ symbol, start: 0, end: 2 }]);
  });

  it("sustains through continuous barlines and stops at NC or unsupported symbols", () => {
    const c = major("C", 2);
    const d = major("D");
    const score = makeScore([
      {},
      { chordSymbols: [c] },
      {},
      { chordSymbols: [chord({ rawText: "NC" }, 1)] },
      { chordSymbols: [d, chord({ rawText: "C7alt" }, 3)] },
      {},
    ]);
    expectSpans(score, [
      { symbol: c, start: 3, end: 6.5 },
      { symbol: d, start: 8, end: 9.5 },
    ]);
  });

  it("disables global chords in both generators without changing ordinary parts", () => {
    const score = makeScore([{ chordSymbols: [major("C")] }]);
    const note: NoteEvent = {
      type: "event",
      duration: { base: "quarter" },
      notes: [{ id: "melody", pitch: { step: "A", octave: 5 } }],
    };
    score.parts[0]!.measures[0]!.sequences[0]!.content = [note];
    const withoutChords = structuredClone(score);
    delete withoutChords.global.measures[0]!.chordSymbols;
    expectSpans(score, [], { includeGlobalChords: false });
    expect(generateTimeline(score, { includeGlobalChords: false }).events).toEqual(
      generateTimeline(withoutChords).events,
    );
    expect(generateTimeline(score).events.filter((event) => event.partIndex === 0)).toEqual(
      generateTimeline(withoutChords).events,
    );
    expect(generatePerformanceEvents(score, 0)).toEqual(generatePerformanceEvents(withoutChords, 0));
    expect(generatePerformanceEvents(score, 0, { includeGlobalChords: false })).toEqual(
      generatePerformanceEvents(withoutChords, 0),
    );
  });

  it("includes global harmony in full and current-part extracted scores when enabled", () => {
    const symbol = major("C");
    const score = makeScore([{ chordSymbols: [symbol] }]);
    score.parts.push({ ...structuredClone(score.parts[0]!), id: "flute", name: "Flute" });
    const extracted: Score = { ...score, parts: [score.parts[1]!] };
    for (const source of [score, extracted]) {
      expect(getChordPlaybackPart(source)).toEqual({
        id: CHORDS_PART_ID,
        partIndex: source.parts.length,
        name: "Chords",
      });
      expectSpans(source, [{ symbol, start: 0, end: 2 }], { includeGlobalChords: true });
      expect(generateTimeline(source).events).toEqual(generateTimeline(source, { includeGlobalChords: true }).events);
    }
  });

  it("is deterministic and never persists or mutates a derived Part", () => {
    const score = makeScore([{ chordSymbols: [major("C", 1), major("D", 3)] }, {}]);
    const before = structuredClone(score);
    const timeline = generateTimeline(score);
    const performance = generatePerformanceEvents(score, score.parts.length);
    getChordPlaybackPart(score);
    expect(generateTimeline(score).events).toEqual(timeline.events);
    expect(generatePerformanceEvents(score, score.parts.length)).toEqual(performance);
    expect(score).toEqual(before);
    expect(score.parts).toHaveLength(1);
    expect(score.parts.some((part) => part.id === CHORDS_PART_ID)).toBe(false);
  });

  it("restores pre-repeat written carry instead of the last performed chord", () => {
    const c = major("C");
    const d = major("D", 2);
    const score = makeScore([{ chordSymbols: [c] }, { repeatStart: {} }, { chordSymbols: [d], repeatEnd: {} }, {}]);
    expect(generateTimeline(score).expandedMeasureToOriginal).toEqual([0, 1, 2, 1, 2, 3]);
    expectSpans(score, [
      { symbol: c, start: 0, end: 5 },
      { symbol: d, start: 5, end: 6 },
      { symbol: c, start: 6, end: 9 },
      { symbol: d, start: 9, end: 12 },
    ]);
  });

  it("restores first-symbol silence on repeat and gives repeated notes unique paired IDs", () => {
    const symbol = major("C", 2);
    const score = makeScore([{ repeatStart: {} }, { chordSymbols: [symbol], repeatEnd: {} }]);
    expectSpans(score, [
      { symbol, start: 3, end: 4 },
      { symbol, start: 7, end: 8 },
    ]);
  });

  it("releases and reattacks the same written carry at a noncontiguous repeat jump", () => {
    const symbol = major("C");
    const score = makeScore([{ chordSymbols: [symbol] }, { repeatStart: {} }, { repeatEnd: {} }]);
    expectSpans(score, [
      { symbol, start: 0, end: 6 },
      { symbol, start: 6, end: 10 },
    ]);
  });

  it("restores written destination carry when a forward volta jump skips a chord", () => {
    const c = major("C");
    const d = major("D");
    const score = makeScore([
      { repeatStart: {}, chordSymbols: [c] },
      { ending: { numbers: [1], duration: 1 }, chordSymbols: [d] },
      { repeatEnd: {} },
    ]);
    expect(generateTimeline(score).expandedMeasureToOriginal).toEqual([0, 1, 2, 0, 2]);
    expectSpans(score, [
      { symbol: c, start: 0, end: 2 },
      { symbol: d, start: 2, end: 6 },
      { symbol: c, start: 6, end: 8 },
      { symbol: d, start: 8, end: 10 },
    ]);
  });

  it("uses whole-note fractions, subbar tempo changes, and inherited 3/4 score end", () => {
    const c = major("C", 1);
    const d = major("D", 2);
    const score = makeScore([
      {
        time: { count: 3, unit: 4 },
        tempos: [
          { bpm: 120, value: { base: "quarter" } },
          { bpm: 60, value: { base: "quarter" }, location: { fraction: [1, 2] } },
        ],
        chordSymbols: [c, d],
      },
      {},
    ]);
    const timeline = generateTimeline(score);
    expect(timeline.measureStartBeats).toEqual([0, 3]);
    expect(timeline.duration).toBeCloseTo(5.25, 10);
    expect(timeline.duration).toBe(timeline.model.timeAtBeat(6));
    expectSpans(score, [
      { symbol: c, start: 0.5, end: 1.25 },
      { symbol: d, start: 1.25, end: 5.25 },
    ]);
  });

  it("uses the continuous tempo model for chord boundaries inside a ramp", () => {
    const c = major("C", 1);
    const d = major("D", 3);
    const score = makeScore([
      {
        gradualTempo: {
          position: { fraction: [0, 1] },
          end: { measure: "m1", position: { fraction: [0, 1] } },
          endBpm: 60,
        },
        chordSymbols: [c, d],
      },
      {},
    ]);
    const timeline = generateTimeline(score);
    expect(timeline.model.timeAtBeat(4)).toBeCloseTo(4 * Math.log(2), 10);
    expectSpans(score, [
      { symbol: c, start: timeline.model.timeAtBeat(1), end: timeline.model.timeAtBeat(3) },
      { symbol: d, start: timeline.model.timeAtBeat(3), end: timeline.model.timeAtBeat(8) },
    ]);
    expect(timeline.duration).toBe(timeline.model.timeAtBeat(8));
  });

  it("sustains chords through fermata holds shared by browser and native timing", () => {
    const c = major("C");
    const d = major("D");
    const score = makeScore([{ chordSymbols: [c] }, { chordSymbols: [d] }]);
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      {
        type: "event",
        duration: { base: "whole" },
        notes: [{ pitch: { step: "C", octave: 5 } }],
        fermata: {},
      },
    ];
    const timeline = generateTimeline(score);
    expect(timeline.measureStartTimes[1]).toBeCloseTo(4, 10);
    expectSpans(score, [
      { symbol: c, start: 0, end: 4 },
      { symbol: d, start: 4, end: 6 },
    ]);
    expect(timeline.duration).toBeCloseTo(6, 10);
  });

  it("uses written cadenza duration rather than the nominal bar length", () => {
    const c = major("C");
    const d = major("D");
    const score = makeScore([
      { time: { count: 2, unit: 4, display: "senzaMisura" }, chordSymbols: [c] },
      { time: { count: 2, unit: 4 }, chordSymbols: [d] },
    ]);
    score.parts[0]!.measures[0]!.sequences[0]!.content = Array.from({ length: 7 }, (): NoteEvent => ({
      type: "event",
      duration: { base: "quarter" },
      notes: [{ pitch: { step: "C", octave: 5 } }],
    }));
    const timeline = generateTimeline(score);
    expect(timeline.measureStartBeats).toEqual([0, 7]);
    expectSpans(score, [
      { symbol: c, start: 0, end: 3.5 },
      { symbol: d, start: 3.5, end: 4.5 },
    ]);
    expect(timeline.duration).toBeCloseTo(4.5, 10);
  });
});
