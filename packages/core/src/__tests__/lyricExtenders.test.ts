import { describe, expect, it } from "vitest";
import { lyricExtenderTargetCandidates, resolveLyricExtenders } from "../operations";
import type { Score } from "../model";

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
