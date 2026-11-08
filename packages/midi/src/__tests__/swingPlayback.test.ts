import { describe, expect, it } from "vitest";
import {
  createDynamicGroup,
  textContentFromPlain,
  type Duration,
  type NoteEvent,
  type Score,
  type SequenceContent,
  type Swing,
} from "@viritura/core";
import { generatePerformanceEvents, generateTimeline } from "../index";
import { timingHumanize, articulationDurationScale } from "../dynamics";
import { compileRhythmProgram, realizeRhythmEvent } from "../rhythmRealization";
import { TempoModel } from "../tempoModel";

function note(id: string, base: Duration["base"] = "16th"): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base },
    markings: { tenuto: {} },
    notes: [{ id, pitch: { step: "C", octave: 4 } }],
  };
}

function fixture(
  content: SequenceContent[] = [note("a"), note("b")],
  swing: Swing = { mode: "swing", subdivision: "16th", ratio: [3, 2] },
): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 }, tempos: [{ bpm: 90, value: { base: "quarter" }, swing }] }],
    },
    parts: [{ name: "Synthetic", measures: [{ sequences: [{ content }] }] }],
  };
}

function pairTimings(score: Score) {
  const sequence = score.parts[0]!.measures[0]!.sequences[0]!;
  return compileRhythmProgram(score).sequences.get(sequence);
}

function verifyNotes(score: Score, expected: { id: string; start: number; beats: number }[]): void {
  const native = generatePerformanceEvents(score, 0);
  const browser = generateTimeline(score);
  for (const { id, start, beats } of expected) {
    const on = native.find((event) => event.kind === "noteOn" && event.note.id === id);
    if (on?.kind !== "noteOn") throw new Error(`Missing synthetic note ${id}`);
    const midi = browser.events.find((event) => event.type === "noteOn" && event.scoreEventId === id);
    if (!midi) throw new Error(`Missing synthetic MIDI event ${id}`);
    const seconds = browser.model.secondsForBeats(start, beats);
    expect(on.time).toBeCloseTo(browser.model.timeAtBeat(start), 12);
    expect(on.note.duration).toBeCloseTo(seconds, 12);
    expect(native.find((event) => event.kind === "noteOff" && event.note === on.note)?.time).toBeCloseTo(
      on.time + seconds,
      12,
    );
    const measureIndex = browser.measureStartBeats.findLastIndex((beat) => beat <= midi.scoreBeat!);
    expect(midi.time).toBeCloseTo(
      Math.max(
        0,
        on.time +
          timingHumanize(
            browser.measureStartTimes[measureIndex]!,
            midi.scoreBeat! - browser.measureStartBeats[measureIndex]!,
            0,
          ),
      ),
      12,
    );
  }
}

describe("shared synthetic swing realization", () => {
  it.each([
    { ratio: [1, 1] as const, first: 1 / 6, second: 1 / 6 },
    { ratio: [3, 2] as const, first: 0.2, second: 2 / 15 },
    { ratio: [2, 1] as const, first: 2 / 9, second: 1 / 9 },
  ])("realizes quarter=90 sixteenth pairs with exact $ratio timing in both generators", ({ ratio, first, second }) => {
    const score = fixture(undefined, { mode: "swing", subdivision: "16th", ratio });
    const a = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    const b = score.parts[0]!.measures[0]!.sequences[0]!.content[1]!;
    if (a.type !== "event" || b.type !== "event") throw new Error("Invalid fixture");
    const timings = pairTimings(score);
    const ra = realizeRhythmEvent(timings, a, 0, 0.25);
    const rb = realizeRhythmEvent(timings, b, 0.25, 0.25);
    expect((ra.beats * 2) / 3).toBeCloseTo(first, 12);
    expect((rb.beats * 2) / 3).toBeCloseTo(second, 12);
    expect(rb.start + rb.beats).toBe(0.5);
    verifyNotes(score, [
      { id: "a", ...ra },
      { id: "b", ...rb },
    ]);
    const native = generatePerformanceEvents(score, 0).filter((event) => event.kind === "noteOn");
    const midi = generateTimeline(score).events;
    const ons = midi.filter((event) => event.type === "noteOn");
    const offs = midi.filter((event) => event.type === "noteOff");
    expect(native[0]!.note.duration).toBeCloseTo(first, 12);
    expect(native[1]!.note.duration).toBeCloseTo(second, 12);
    expect(offs[0]!.time - ons[0]!.time).toBeCloseTo(first, 12);
    expect(offs[1]!.time - ons[1]!.time).toBeCloseTo(second, 12);
  });

  it("grooves before browser articulation and leaves native articulation flags for its mapper", () => {
    const a = note("a");
    a.markings = { staccato: {} };
    const score = fixture([a, note("b")]);
    const timeline = generateTimeline(score);
    const on = timeline.events.find((event) => event.type === "noteOn")!;
    const off = timeline.events.find((event) => event.type === "noteOff")!;
    expect(off.time - on.time).toBeCloseTo(0.2 * articulationDurationScale(a.markings), 12);
    const native = generatePerformanceEvents(score, 0).find((event) => event.kind === "noteOn");
    if (native?.kind !== "noteOn") throw new Error("Missing note");
    expect(native.note.duration).toBeCloseTo(0.2, 12);
    expect(native.note.articulations.staccato).toBe(true);
  });

  it("keeps chord heads simultaneous and eighth, quarter and bar boundaries fixed for swung sixteenths", () => {
    const a = note("a");
    a.notes!.push({ id: "a-high", pitch: { step: "E", octave: 4 } });
    const score = fixture([a, note("b"), note("c"), note("d"), note("e", "eighth"), note("f", "quarter")]);
    verifyNotes(score, [
      { id: "a", start: 0, beats: 0.3 },
      { id: "b", start: 0.3, beats: 0.2 },
      { id: "c", start: 0.5, beats: 0.3 },
      { id: "d", start: 0.8, beats: 0.2 },
      { id: "e", start: 1, beats: 0.5 },
      { id: "f", start: 1.5, beats: 1 },
    ]);
    const native = generatePerformanceEvents(score, 0).filter((event) => event.kind === "noteOn");
    expect(native[0]!.time).toBe(native[1]!.time);
    const browser = generateTimeline(score);
    const ons = browser.events.filter((event) => event.type === "noteOn");
    expect(ons[0]!.time).toBe(ons[1]!.time);
    expect(browser.duration).toBeCloseTo(8 / 3, 12);
  });

  it.each([true, false])("pairs rests as nominal rhythm, rest first=$0", (restFirst) => {
    const rest: NoteEvent = { type: "event", duration: { base: "16th" }, rest: {} };
    const score = fixture(restFirst ? [rest, note("b")] : [note("a"), rest]);
    verifyNotes(score, [{ id: restFirst ? "b" : "a", start: restFirst ? 0.3 : 0, beats: restFirst ? 0.2 : 0.3 }]);
    expect(generatePerformanceEvents(score, 0).filter((event) => event.kind === "noteOn")).toHaveLength(1);
  });

  it("leaves partial, unequal, dotted, off-grid and space-interrupted pairs literal", () => {
    const dotted = note("dotted");
    dotted.duration.dots = 1;
    const score = fixture([
      note("alone"),
      { type: "space", duration: [1, 16] },
      dotted,
      note("unequal", "32nd"),
      note("off-grid"),
      note("end", "quarter"),
    ]);
    expect(pairTimings(score)?.size).toBe(0);
    verifyNotes(score, [
      { id: "alone", start: 0, beats: 0.25 },
      { id: "dotted", start: 0.5, beats: 0.375 },
      { id: "unequal", start: 0.875, beats: 0.125 },
      { id: "off-grid", start: 1, beats: 0.25 },
      { id: "end", start: 1.25, beats: 1 },
    ]);
  });

  it("does not double-swing explicit tuplets, grace voices or generated ornament rhythms", () => {
    const trill = note("trill");
    trill.markings = { trill: {} };
    const contents: SequenceContent[][] = [
      [
        {
          type: "tuplet",
          outer: { duration: { base: "eighth" }, multiple: 1 },
          inner: { duration: { base: "16th" }, multiple: 2 },
          content: [note("a"), note("b")],
        },
      ],
      [{ type: "grace", content: [note("g", "32nd")] }, note("a"), note("b")],
      [trill, note("b")],
      [
        {
          type: "tremolo",
          outer: { duration: { base: "eighth" }, multiple: 1 },
          marks: 2,
          content: [note("a"), note("b")],
        },
      ],
    ];
    for (const content of contents) {
      const score = fixture(content);
      const straight = structuredClone(score);
      straight.global.measures[0]!.tempos![0]!.swing = { mode: "straight" };
      expect(pairTimings(score)?.size).toBe(0);
      expect(generateTimeline(score).events).toEqual(generateTimeline(straight).events);
      expect(generatePerformanceEvents(score, 0)).toEqual(generatePerformanceEvents(straight, 0));
    }
  });

  it("rejects invalid in-memory ratios instead of silently defaulting", () => {
    for (const ratio of [
      [0, 2],
      [1.5, 2],
      [Infinity, 2],
      [Number.MAX_SAFE_INTEGER + 1, 2],
    ] as const) {
      const score = fixture(undefined, { mode: "swing", subdivision: "16th", ratio });
      expect(() => generateTimeline(score)).toThrow("positive safe integers");
      expect(() => generatePerformanceEvents(score, 0)).toThrow("positive safe integers");
    }
  });

  it("preserves straight/absent baseline and treats cosmetic text as cosmetic", () => {
    const score = fixture(undefined, { mode: "straight" });
    const absent = structuredClone(score);
    delete absent.global.measures[0]!.tempos![0]!.swing;
    absent.global.measures[0]!.tempos![0]!.text = textContentFromPlain("J-Pop, Swung16ths");
    expect(generateTimeline(score).events).toEqual(generateTimeline(absent).events);
    expect(generatePerformanceEvents(score, 0)).toEqual(generatePerformanceEvents(absent, 0));
  });

  it("keeps instructions inside a pair literal and honors coincident order, mixed subdivisions and BPM inheritance", () => {
    const score = fixture(Array.from({ length: 8 }, (_, index) => note(`n${index}`)));
    score.global.measures[0]!.tempos!.push(
      { swing: { mode: "straight" }, location: { fraction: [1, 16] } },
      { swing: { mode: "swing", subdivision: "eighth", ratio: [2, 1] }, location: { fraction: [1, 8] } },
      { swing: { mode: "swing", subdivision: "16th", ratio: [2, 1] }, location: { fraction: [1, 8] } },
      { bpm: 90, value: { base: "quarter" }, location: { fraction: [1, 4] } },
    );
    verifyNotes(score, [
      { id: "n0", start: 0, beats: 0.25 },
      { id: "n1", start: 0.25, beats: 0.25 },
      { id: "n2", start: 0.5, beats: 1 / 3 },
      { id: "n3", start: 5 / 6, beats: 1 / 6 },
      { id: "n4", start: 1, beats: 1 / 3 },
      { id: "n5", start: 4 / 3, beats: 1 / 6 },
    ]);
    const eighths = fixture([note("a", "eighth"), note("b", "eighth")], {
      mode: "swing",
      subdivision: "eighth",
      ratio: [3, 2],
    });
    verifyNotes(eighths, [
      { id: "a", start: 0, beats: 0.6 },
      { id: "b", start: 0.6, beats: 0.4 },
    ]);
    const mixed = fixture([note("a", "eighth"), note("b", "eighth"), note("c"), note("d")], {
      mode: "swing",
      subdivision: "eighth",
      ratio: [3, 2],
    });
    mixed.global.measures[0]!.tempos!.push({
      swing: { mode: "swing", subdivision: "16th", ratio: [2, 1] },
      location: { fraction: [1, 4] },
    });
    verifyNotes(mixed, [
      { id: "a", start: 0, beats: 0.6 },
      { id: "b", start: 0.6, beats: 0.4 },
      { id: "c", start: 1, beats: 1 / 3 },
      { id: "d", start: 4 / 3, beats: 1 / 6 },
    ]);
  });

  it("right-aligns pickup phase and resets the next bar's grid to its written source", () => {
    const score = fixture(Array.from({ length: 5 }, (_, index) => note(`n${index}`)));
    score.global.measures[0]!.number = 0;
    score.global.measures.push({});
    score.parts[0]!.measures.push({ sequences: [{ content: [note("next-a"), note("next-b")] }] });
    verifyNotes(score, [
      { id: "n0", start: 0, beats: 0.25 },
      { id: "n1", start: 0.25, beats: 0.3 },
      { id: "n2", start: 0.55, beats: 0.2 },
      { id: "next-a", start: 1.25, beats: 0.3 },
      { id: "next-b", start: 1.55, beats: 0.2 },
    ]);
    expect(generateTimeline(score).measureStartBeats).toEqual([0, 1.25]);
  });

  it.each([
    { count: 3, unit: 4 },
    { count: 6, unit: 8 },
    { count: 5, unit: 8 },
  ])("uses whole-note source positions in $count/$unit", (time) => {
    const score = fixture(
      Array.from({ length: 8 }, (_, index) => note(`n${index}`)),
      { mode: "straight" },
    );
    score.global.measures[0]!.time = time;
    score.global.measures[0]!.tempos!.push({
      swing: { mode: "swing", subdivision: "16th", ratio: [3, 2] },
      location: { fraction: [1, 4] },
    });
    verifyNotes(score, [
      { id: "n1", start: 0.25, beats: 0.25 },
      { id: "n4", start: 1, beats: 0.3 },
      { id: "n5", start: 1.3, beats: 0.2 },
    ]);
  });

  it("diagnoses unsupported inherited local staff meters rather than applying swing globally", () => {
    const score = fixture();
    score.parts[0]!.measures[0]!.staffMeters = [
      { staff: 1, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" },
    ];
    const timeline = generateTimeline(score);
    expect(timeline.diagnostics).toContainEqual(expect.objectContaining({ code: "swing-staff-meter-unsupported" }));
    expect(() => generatePerformanceEvents(score, 0)).toThrow("local staff meters");
    const diagnostics: string[] = [];
    const native = generatePerformanceEvents(score, 0, {
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.code),
    });
    expect(diagnostics).toEqual(["swing-staff-meter-unsupported"]);
    const ons = native.filter((event) => event.kind === "noteOn");
    expect(ons[1]!.time).toBeCloseTo((((0.25 * 4) / 3) * 2) / 3, 12);
    score.global.measures.push({ tempos: [{ swing: { mode: "straight" } }] });
    score.parts[0]!.measures.push({ sequences: [{ content: [note("straight-a"), note("straight-b")] }] });
    expect(
      generateTimeline(score).diagnostics!.filter((diagnostic) => diagnostic.code === "swing-staff-meter-unsupported"),
    ).toHaveLength(1);
  });

  it("preserves tied continuations and cross-bar ties without a reattack", () => {
    const a = note("a");
    a.notes![0]!.ties = [{ target: "b" }];
    const b = note("b");
    b.notes![0]!.ties = [{ target: "c" }];
    const score = fixture([a, b]);
    score.global.measures[0]!.time = { count: 1, unit: 8 };
    score.global.measures.push({});
    score.parts[0]!.measures.push({ sequences: [{ content: [note("c"), note("d")] }] });
    const native = generatePerformanceEvents(score, 0).filter((event) => event.kind === "noteOn");
    expect(native.map((event) => event.note.id)).toEqual(["a", "d"]);
    expect(native[0]!.note.duration).toBeCloseTo((0.8 * 2) / 3, 12);
    const midi = generateTimeline(score).events;
    expect(midi.filter((event) => event.type === "noteOn")).toHaveLength(2);
    expect(midi.find((event) => event.type === "noteOff")!.time).toBeCloseTo((0.8 * 2) / 3, 12);
  });

  it("resolves slur release against the grooved next attack before humanization", () => {
    const a = note("a");
    a.slurs = [{ target: "b" }];
    const b = note("b");
    b.notes![0]!.pitch.step = "D";
    const timeline = generateTimeline(fixture([a, b]));
    const next = timeline.events.find((event) => event.type === "noteOn" && event.scoreEventId === "b")!;
    const firstOff = timeline.events.find((event) => event.type === "noteOff" && event.midiNote === 60)!;
    expect(firstOff.time).toBeCloseTo(next.time + 0.02, 12);
  });

  it("composes onset/release with continuous ramps and holds without BPM-free resets", () => {
    const score = fixture(Array.from({ length: 16 }, (_, index) => note(`n${index}`)));
    score.global.measures[0]!.id = "m0";
    score.global.measures[0]!.gradualTempo = {
      position: { fraction: [0, 1] },
      end: { measure: "m1", position: { fraction: [1, 1] } },
      endBpm: 60,
    };
    score.global.measures.push({
      id: "m1",
      tempos: [{ swing: { mode: "swing", subdivision: "16th", ratio: [2, 1] } }],
    });
    score.parts[0]!.measures.push({ sequences: [{ content: [note("next-a"), note("next-b")] }] });
    const timeline = generateTimeline(score);
    expect(timeline.model.bpmAtBeat(4)).toBeCloseTo(75, 12);
    verifyNotes(score, [
      { id: "n1", start: 0.3, beats: 0.2 },
      { id: "next-a", start: 4, beats: 1 / 3 },
      { id: "next-b", start: 4 + 1 / 3, beats: 1 / 6 },
    ]);
    const held = fixture();
    const first = held.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (first.type !== "event") throw new Error("Invalid fixture");
    first.fermata = {};
    const native = generatePerformanceEvents(held, 0).filter((event) => event.kind === "noteOn");
    expect(native[0]!.note.duration).toBeCloseTo(1 / 3, 12);
    expect(native[1]!.time).toBeCloseTo(1 / 3, 12);
    expect(pairTimings(held)?.size).toBe(0);
    // A hold at the pair endpoint does not move that endpoint or exclude swing.
    delete first.fermata;
    const second = held.parts[0]!.measures[0]!.sequences[0]!.content[1]!;
    if (second.type !== "event") throw new Error("Invalid fixture");
    second.fermata = {};
    const heldNative = generatePerformanceEvents(held, 0).filter((event) => event.kind === "noteOn");
    expect(heldNative[1]!.time).toBeCloseTo(0.2, 12);
    expect(heldNative[1]!.time + heldNative[1]!.note.duration).toBeCloseTo(0.5, 12);
    const heldMidi = generateTimeline(held).events;
    expect(
      heldMidi.filter((event) => event.type === "noteOff")[1]!.time -
        heldMidi.filter((event) => event.type === "noteOn")[1]!.time,
    ).toBeCloseTo(0.3, 12);
  });

  it("preserves hold endpoint inclusion/exclusion in the shared timing integration", () => {
    const model = TempoModel.build(
      [{ startBeat: 0, endBeat: Infinity, startBpm: 90, endBpm: 90 }],
      [{ beat: 0.5, seconds: 1 }],
    );
    expect(model.secondsForBeats(0.3, 0.2)).toBeCloseTo(2 / 15, 12);
    expect(model.secondsForBeats(0.3, 0.3)).toBeCloseTo(0.2 + 1, 12);
    expect(model.secondsForBeats(0.5, 0.3)).toBeCloseTo(0.2, 12);
  });

  it("restores swing from written source on repeats instead of leaking a later Straight instruction", () => {
    const score = fixture();
    score.global.measures[0]!.repeatStart = {};
    score.global.measures.push({ tempos: [{ swing: { mode: "straight" } }], repeatEnd: { times: 2 } });
    score.parts[0]!.measures.push({ sequences: [{ content: [note("c"), note("d")] }] });
    const native = generatePerformanceEvents(score, 0).filter((event) => event.kind === "noteOn");
    const durations = [0.2, 2 / 15, 1 / 6, 1 / 6, 0.2, 2 / 15, 1 / 6, 1 / 6];
    native.forEach((event, index) => expect(event.note.duration).toBeCloseTo(durations[index]!, 12));
    const timeline = generateTimeline(score);
    expect(timeline.expandedMeasureToOriginal).toEqual([0, 1, 0, 1]);
    const browser = timeline.events.filter((event) => event.type === "noteOn");
    native.forEach((event, index) => expect(Math.abs(event.time - browser[index]!.time)).toBeLessThanOrEqual(0.015));
  });

  it("retains source phase at mid-measure jumps and leaves entry/exit partial pairs literal", () => {
    const score = fixture(Array.from({ length: 16 }, (_, index) => note(`n${index}`)));
    score.global.measures[0]!.segno = { location: { fraction: [1, 16] } };
    score.global.measures.push({
      tempos: [{ swing: { mode: "straight" } }],
      jump: { type: "segno", location: { fraction: [1, 16] } },
    });
    score.parts[0]!.measures.push({ sequences: [{ content: [note("x"), note("y")] }] });
    const native = generatePerformanceEvents(score, 0).filter((event) => event.kind === "noteOn");
    const revisits = native.filter((event) => event.note.id === "n1");
    expect(revisits).toHaveLength(2);
    expect(revisits[0]!.note.duration).toBeCloseTo(2 / 15, 12);
    expect(revisits[1]!.note.duration).toBeCloseTo(1 / 6, 12);
    const n2 = native.filter((event) => event.note.id === "n2");
    expect(n2[1]!.note.duration).toBeCloseTo(0.2, 12);
    const timeline = generateTimeline(score);
    expect(timeline.playedSpans?.[2]?.startBeat).toBe(0.25);
    const browser = timeline.events.filter((event) => event.type === "noteOn");
    expect(browser).toHaveLength(native.length);
    native.forEach((event, index) => expect(Math.abs(event.time - browser[index]!.time)).toBeLessThanOrEqual(0.015));
    expect(timeline.model.beatAtTime(timeline.measureStartTimes[2]!)).toBeCloseTo(4.25, 12);
  });

  it("keeps derived chord and continuous controller anchors literal on the score clock", () => {
    const score = fixture();
    score.global.measures[0]!.chordSymbols = [{ root: { step: "C" }, position: { fraction: [1, 16] } }];
    score.parts[0]!.measures[0]!.dynamics = [createDynamicGroup("f", { fraction: [1, 16] }, "synthetic-dynamic")];
    const straight = structuredClone(score);
    straight.global.measures[0]!.tempos![0]!.swing = { mode: "straight" };
    const timeline = generateTimeline(score);
    const baseline = generateTimeline(straight);
    expect(timeline.events.filter((event) => event.type === "controlChange")).toEqual(
      baseline.events.filter((event) => event.type === "controlChange"),
    );
    expect(timeline.events.filter((event) => event.partIndex === 1)).toEqual(
      baseline.events.filter((event) => event.partIndex === 1),
    );
    const chords = generatePerformanceEvents(score, 1).filter((event) => event.kind === "noteOn");
    expect(chords[0]!.time).toBeCloseTo(1 / 6, 12);
    expect(generatePerformanceEvents(score, 1)).toEqual(generatePerformanceEvents(straight, 1));
    const native = generatePerformanceEvents(score, 0);
    const nativeStraight = generatePerformanceEvents(straight, 0);
    expect(native.filter((event) => event.kind === "dynamics")).toEqual(
      nativeStraight.filter((event) => event.kind === "dynamics"),
    );
  });

  it("samples native technique state at realized attacks while technique anchors stay literal", () => {
    const score = fixture(undefined, { mode: "swing", subdivision: "16th", ratio: [1, 2] });
    score.parts[0]!.measures[0]!.expressions = [
      { text: textContentFromPlain("pizz."), position: { fraction: [1, 16] } },
    ];
    const native = generatePerformanceEvents(score, 0);
    const ons = native.filter((event) => event.kind === "noteOn");
    expect(ons[1]!.time).toBeCloseTo(1 / 9, 12);
    expect(ons[1]!.note.state.pizzicato).toBe(false);
    expect(native.find((event) => event.kind === "technique")?.time).toBeCloseTo(1 / 6, 12);
  });

  it("plays an independently authored 87-slot pickup/navigation analogue without changing its written clock", () => {
    const score = fixture();
    score.global.measures = Array.from({ length: 87 }, (_, index) => ({ number: index }));
    score.global.measures[0] = {
      number: 0,
      time: { count: 4, unit: 4 },
      tempos: [
        {
          bpm: 90,
          value: { base: "quarter" },
          text: textContentFromPlain("Synthetic: Swung16ths is cosmetic"),
          swing: { mode: "swing", subdivision: "16th", ratio: [3, 2] },
        },
      ],
    };
    score.parts[0]!.staves = 2;
    score.parts[0]!.measures = score.global.measures.map((_, index) => ({
      sequences: [
        {
          content:
            index === 0
              ? [note("pickup", "quarter")]
              : Array.from({ length: 16 }, (_, beat) => note(`m${index}n${beat}`)),
        },
      ],
    }));
    score.global.measures[68]!.repeatStart = true;
    score.global.measures[75]!.ending = { numbers: [1], duration: 1 };
    score.global.measures[75]!.repeatEnd = {};
    score.global.measures[78]!.repeatStart = true;
    score.global.measures[80]!.ending = { numbers: [1], duration: 2 };
    score.global.measures[81]!.repeatEnd = {};
    const outgoing = score.parts[0]!.measures[61]!.sequences[0]!.content[15]!;
    if (outgoing.type !== "event") throw new Error("Invalid synthetic tie");
    outgoing.notes![0]!.ties = [{ target: "m62n0" }];
    outgoing.slurs = [{ target: "m62n1" }];
    const finalRight = note("final-rh", "whole");
    finalRight.notes!.push({ id: "final-rh-high", pitch: { step: "E", octave: 4 } });
    finalRight.fermata = {};
    const finalLeft = note("final-lh", "half");
    finalLeft.fermata = {};
    score.parts[0]!.measures[86] = {
      sequences: [
        { staff: 1, content: [finalRight] },
        { staff: 2, content: [{ type: "event", duration: { base: "half" }, rest: {} }, finalLeft] },
      ],
    };
    const before = structuredClone(score);
    const written = generateTimeline(score, { expandRepeats: false });
    const timeline = generateTimeline(score);
    const itinerary = [
      ...Array.from({ length: 76 }, (_, index) => index),
      ...Array.from({ length: 7 }, (_, index) => 68 + index),
      ...Array.from({ length: 6 }, (_, index) => 76 + index),
      78,
      79,
      ...Array.from({ length: 5 }, (_, index) => 82 + index),
    ];
    expect(written.totalBeats).toBe(345);
    expect(timeline.expandedMeasureToOriginal).toEqual(itinerary);
    expect(itinerary).toHaveLength(96);
    expect(timeline.totalBeats).toBe(381);
    expect(timeline.duration).toBeCloseTo(((381 + 2) * 2) / 3, 10);
    const native = generatePerformanceEvents(score, 0);
    const ons = native.filter((event) => event.kind === "noteOn");
    expect(ons.some((event) => event.note.id === "m62n0")).toBe(false);
    expect(ons.filter((event) => event.note.id === "m68n1")).toHaveLength(2);
    expect(
      ons.filter((event) => event.note.id === "m68n1").every((event) => Math.abs(event.note.duration - 2 / 15) < 1e-10),
    ).toBe(true);
    const finalOffs = native.filter((event) => event.kind === "noteOff" && event.note.id.startsWith("final-"));
    expect(finalOffs).toHaveLength(3);
    finalOffs.forEach((event) => expect(event.time).toBeCloseTo(timeline.duration, 10));
    expect(score).toEqual(before);
  });
});
