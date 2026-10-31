import { describe, expect, it } from "vitest";
import { lyricExtenderTargetCandidates, resolveLyricExtenders } from "../operations";
import type { NoteEvent, Score } from "../model";

function scoreWithLyrics(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 } }, {}],
    },
    parts: [
      {
        id: "voice",
        name: "Voice",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "start",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "C", octave: 4 } }],
                    lyrics: { lines: { verse: { text: "Ah" } } },
                  },
                  {
                    type: "event",
                    id: "melisma-1",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "D", octave: 4 } }],
                  },
                  {
                    type: "event",
                    id: "melisma-2",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "E", octave: 4 } }],
                  },
                  {
                    type: "event",
                    id: "next-word",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "F", octave: 4 } }],
                    lyrics: { lines: { verse: { text: "now" } } },
                  },
                ],
              },
            ],
          },
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "explicit-source",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "G", octave: 4 } }],
                    lyrics: { lines: { verse: { text: "Go", extender: { target: "far-target" } } } },
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "other-part",
        name: "Other",
        measures: [
          { sequences: [] },
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "far-target",
                    duration: { base: "half" },
                    notes: [{ pitch: { step: "C", octave: 4 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as Score;
}

describe("resolveLyricExtenders", () => {
  it.each([undefined, "singer"])("stops inference at an empty fullMeasure rest (voice=%s)", (voice) => {
    const score = scoreWithLyrics();
    const first = score.parts[0]!.measures[0]!;
    first.sequences[0]!.voice = voice;
    first.sequences[0]!.content = first.sequences[0]!.content.slice(0, 1);
    score.parts = [score.parts[0]!];
    const part = score.parts[0]!;
    part.measures = [
      first,
      { sequences: [{ voice, fullMeasure: { visualDuration: { base: "whole" } }, content: [] }] },
      { sequences: [{ voice, content: [event("later")] }] },
    ];
    score.global.measures.push({});
    expect(resolveLyricExtenders(score).extenders).toEqual([]);
    delete part.measures[1]!.sequences[0]!.fullMeasure;
    expect(resolveLyricExtenders(score).extenders[0]?.targetEventId).toBe("later");
    if (voice) {
      part.measures[1]!.sequences.unshift({ voice: "unrelated", content: [] });
      part.measures[1]!.sequences[1]!.fullMeasure = { visualDuration: { base: "whole" } };
      expect(resolveLyricExtenders(score).extenders).toEqual([]);
    }
  });
  function event(id: string, base: NoteEvent["duration"]["base"] = "quarter"): NoteEvent {
    return { type: "event", id, duration: { base }, notes: [{ pitch: { step: "C", octave: 4 } }] };
  }

  it("maps inherited staff-local fitMeasure beats before comparing cross-staff targets", () => {
    const score = scoreWithLyrics();
    score.global.measures = [{ time: { count: 2, unit: 4 } }, {}];
    const source = event("source");
    source.lyrics = { lines: { verse: { text: "Ah", extender: { target: "target" } } } };
    const part = score.parts[0]!;
    part.measures = [
      { staffMeters: [{ staff: 1, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" }], sequences: [] },
      {
        sequences: [
          { staff: 1, content: [event("lead", "half"), source] },
          { staff: 2, content: [event("other-lead", "quarter"), event("target")] },
        ],
      },
    ];
    score.parts = [part];
    expect(resolveLyricExtenders(score).diagnostics).toEqual([
      expect.objectContaining({ code: "backward-target", sourceEventId: "source" }),
    ]);
    source.lyrics!.lines!.verse!.extender!.target = "source";
    expect(resolveLyricExtenders(score).extenders[0]?.startBeat).toBeCloseTo(10 / 3);
    expect(resolveLyricExtenders(score).extenders[0]?.endBeat).toBeCloseTo(4);
  });

  it("does not pad a spanning tuplet fragment to its entire declared outer duration", () => {
    const score = scoreWithLyrics();
    const source = event("source");
    source.lyrics = { lines: { verse: { text: "Ah", extender: { target: "target" } } } };
    const sequence = score.parts[0]!.measures[0]!.sequences[0]!;
    sequence.content = [
      {
        type: "tuplet",
        inner: { multiple: 3, duration: { base: "eighth" } },
        outer: { multiple: 2, duration: { base: "eighth" } },
        span: { id: "triplet", type: "start" },
        content: [event("tuplet-note", "eighth")],
      },
      source,
      event("target"),
    ];
    score.parts = [score.parts[0]!];
    score.parts[0]!.measures = [score.parts[0]!.measures[0]!];
    expect(resolveLyricExtenders(score).extenders[0]?.startBeat).toBeCloseTo(1 / 3);
  });

  it("subdivides tremolo outer duration equally even when component written values differ", () => {
    const score = scoreWithLyrics();
    const source = event("source", "half");
    source.lyrics = { lines: { verse: { text: "Ah", extender: { target: "target" } } } };
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      {
        type: "tremolo",
        marks: 3,
        outer: { multiple: 1, duration: { base: "half" } },
        content: [source, event("target", "quarter")],
      },
    ];
    score.parts = [score.parts[0]!];
    score.parts[0]!.measures = [score.parts[0]!.measures[0]!];
    expect(resolveLyricExtenders(score).extenders[0]).toMatchObject({ startBeat: 0, endBeat: 2 });
  });

  it("advances an open-meter bar by its written span so the following bar is never backward", () => {
    const score = scoreWithLyrics();
    score.global.measures[0]!.time!.display = "senzaMisura";
    const source = event("source");
    source.lyrics = { lines: { verse: { text: "Ah", extender: { target: "target" } } } };
    score.parts[0]!.measures[0]!.sequences[0]!.content = [event("long-lead", "breve"), source];
    score.parts[0]!.measures[1]!.sequences[0]!.content = [event("target")];
    score.parts = [score.parts[0]!];
    expect(resolveLyricExtenders(score).diagnostics).toEqual([]);
    expect(resolveLyricExtenders(score).extenders[0]).toMatchObject({ startBeat: 8, endBeat: 10 });
  });
  it("follows named voices across reordered sequences without crossing staves", () => {
    const score = scoreWithLyrics();
    const first = score.parts[0]!.measures[0]!.sequences[0]!;
    first.voice = "singer";
    first.content = first.content.slice(0, 1);
    const next = score.parts[0]!.measures[1]!.sequences[0]!;
    next.voice = "singer";
    const continuation = next.content[0]!;
    if (continuation.type !== "event") throw new Error("Expected event");
    delete continuation.lyrics;
    score.parts[0]!.measures[1]!.sequences.unshift({
      voice: "other",
      content: [{ type: "event", duration: { base: "whole" }, rest: {} }],
    });
    expect(resolveLyricExtenders(score).extenders).toEqual([
      expect.objectContaining({ sourceEventId: "start", targetEventId: "explicit-source" }),
    ]);
    next.staff = 2;
    expect(resolveLyricExtenders(score).extenders).toEqual([]);
    next.staff = 1;
    delete first.voice;
    delete next.voice;
    expect(resolveLyricExtenders(score).extenders).toEqual([]);
  });

  it("diagnoses intervening syllables in a named voice after sequence reordering", () => {
    const score = scoreWithLyrics();
    const first = score.parts[0]!.measures[0]!.sequences[0]!;
    first.voice = "singer";
    first.content = first.content.slice(0, 1);
    const source = first.content[0]!;
    if (source.type !== "event") throw new Error("Expected event");
    source.lyrics!.lines!.verse!.extender = { target: "far-target" };
    const next = score.parts[0]!.measures[1]!.sequences[0]!;
    next.voice = "singer";
    score.parts[0]!.measures[1]!.sequences.unshift({ voice: "other", content: [] });
    expect(resolveLyricExtenders(score).diagnostics).toEqual([
      expect.objectContaining({ code: "conflicting-target", sourceEventId: "start" }),
    ]);
  });

  it("diagnoses targets crossing an intervening syllable and backward targets", () => {
    const score = scoreWithLyrics();
    const source = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    const later = score.parts[0]!.measures[1]!.sequences[0]!.content[0]!;
    if (source.type !== "event" || later.type !== "event") throw new Error("Expected events");
    source.lyrics!.lines!.verse!.extender = { target: "explicit-source" };
    later.lyrics!.lines!.verse!.extender = { target: "start" };
    expect(resolveLyricExtenders(score).diagnostics.map((issue) => issue.code)).toEqual([
      "conflicting-target",
      "backward-target",
    ]);
  });

  it("accepts self targets and ignores invalid references under explicit suppression", () => {
    const score = scoreWithLyrics();
    score.mnx.support = { useLyricExtenders: true };
    const source = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    const later = score.parts[0]!.measures[1]!.sequences[0]!.content[0]!;
    if (source.type !== "event" || later.type !== "event") throw new Error("Expected events");
    source.lyrics!.lines!.verse!.extender = { target: "start" };
    later.lyrics!.lines!.verse!.extender = { show: false, target: "missing" };
    const result = resolveLyricExtenders(score);
    expect(result.diagnostics).toEqual([]);
    expect(result.extenders).toEqual([
      expect.objectContaining({ sourceEventId: "start", targetEventId: "start", endBeat: 1 }),
    ]);
  });

  it("infers melismas through textless notes and resolves explicit cross-part targets through their full duration", () => {
    const result = resolveLyricExtenders(scoreWithLyrics());
    expect(result.extenders).toEqual([
      expect.objectContaining({
        sourceEventId: "start",
        targetEventId: "melisma-2",
        startMeasure: 0,
        endMeasure: 0,
        explicit: false,
      }),
      expect.objectContaining({
        sourceEventId: "explicit-source",
        targetEventId: "far-target",
        partIndex: 0,
        endMeasure: 1,
        explicit: true,
      }),
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it("offers endpoint candidates from every part at or after the source's musical time", () => {
    const candidates = lyricExtenderTargetCandidates(scoreWithLyrics(), "explicit-source");
    expect(candidates.map(({ eventId }) => eventId)).toEqual(["explicit-source", "far-target"]);
  });

  it("suppresses absent extenders when the support policy is explicit and ignores hidden targets", () => {
    const score = scoreWithLyrics();
    score.mnx.support = { useLyricExtenders: true };
    const source = score.parts[0]!.measures[1]!.sequences[0]!.content[0]!;
    if (source.type === "event") source.lyrics!.lines!.verse!.extender!.show = false;
    expect(resolveLyricExtenders(score).extenders).toEqual([]);
  });

  it("reports missing and conflicting active targets", () => {
    const score = scoreWithLyrics();
    const first = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (first.type === "event") first.lyrics!.lines!.verse!.extender = { target: "missing" };
    const explicit = score.parts[0]!.measures[1]!.sequences[0]!.content[0]!;
    if (explicit.type === "event") explicit.lyrics!.lines!.verse!.extender = { target: "far-target" };
    score.parts[1]!.measures[1]!.sequences[0]!.content[0] = {
      type: "event",
      id: "far-target",
      duration: { base: "half" },
      notes: [{ pitch: { step: "C", octave: 4 } }],
      lyrics: { lines: { verse: { text: "conflict" } } },
    };
    expect(resolveLyricExtenders(score).diagnostics.map((issue) => issue.code)).toEqual([
      "missing-target",
      "conflicting-target",
    ]);
  });
});
