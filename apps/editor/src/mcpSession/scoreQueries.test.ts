import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { getMeasureSlice } from "./scoreQueries";
import { searchAnnotations } from "./annotationSearch";
import { getNoteTable } from "./noteTable";
import { getSectionTimings } from "./scoreTimeline";

function scoreWithMusic(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        { id: "pickup", number: 0, time: { count: 4, unit: 4 }, rehearsalMark: { text: [{ text: "Intro" }] } },
        {
          id: "second",
          number: 42,
          systemText: [{ id: "system", text: [{ text: "Play softly" }], position: { fraction: [0, 1] } }],
        },
      ],
    },
    parts: [
      {
        id: "flute",
        name: "Flute",
        measures: [
          {
            expressions: [
              { text: [{ text: "soft" }, { text: "ly" }], position: { fraction: [0, 1] }, staff: 1 },
              { text: [{ text: "loudly" }], position: { fraction: [1, 2] } },
            ],
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "first",
                    duration: { base: "quarter" },
                    notes: [{ id: "n1", pitch: { step: "C", octave: 4 } }],
                  },
                  {
                    type: "tuplet",
                    inner: { multiple: 3, duration: { base: "eighth" } },
                    outer: { multiple: 2, duration: { base: "eighth" } },
                    content: ["t1", "t2", "t3"].map((id) => ({
                      type: "event",
                      id,
                      duration: { base: "eighth" },
                      notes: [{ pitch: { step: "D", octave: 4 } }],
                    })),
                  },
                  {
                    type: "grace",
                    content: [
                      {
                        type: "event",
                        id: "grace",
                        duration: { base: "eighth" },
                        notes: [{ pitch: { step: "E", octave: 4 } }],
                      },
                    ],
                  },
                  {
                    type: "event",
                    id: "after",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "F", octave: 4 } }],
                    lyrics: { lines: { "1": { text: "softly" } } },
                  },
                  {
                    type: "tremolo",
                    marks: 2,
                    outer: { multiple: 1, duration: { base: "half" } },
                    content: [
                      {
                        type: "event",
                        id: "tr1",
                        duration: { base: "quarter" },
                        notes: [{ pitch: { step: "G", octave: 4 } }],
                      },
                      {
                        type: "event",
                        id: "tr2",
                        duration: { base: "quarter" },
                        notes: [{ pitch: { step: "A", octave: 4 } }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          { sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }] },
        ],
      },
    ],
  };
}

describe("bounded MCP score queries", () => {
  it("resolves stable measure IDs and distinguishes pickup numbers from ordinals", () => {
    const score = scoreWithMusic();
    const result = getMeasureSlice(score, { startMeasureId: "pickup", endMeasureId: "second" });
    expect(result.measureReferences).toEqual([
      { measureId: "pickup", measureIndex: 0, measureOrdinal: 1, measureNumber: 0 },
      { measureId: "second", measureIndex: 1, measureOrdinal: 2, measureNumber: 42 },
    ]);
    expect(() => getMeasureSlice(score, { startMeasure: 1, startMeasureId: "pickup" })).toThrow(/either/);
    expect(() => getMeasureSlice(score, { startMeasureId: "missing" })).toThrow(/missing or not unique/);
  });

  it("searches and paginates editable annotation locations", () => {
    const score = scoreWithMusic();
    const first = searchAnnotations(score, { query: "SOFT", limit: 1 });
    expect(first).toMatchObject({
      total: 3,
      nextOffset: 1,
      annotations: [{ kind: "staffText", text: "softly", partId: "flute", expressionIndex: 0, measureId: "pickup" }],
    });
    const second = searchAnnotations(score, { query: "soft", offset: 1, limit: 2 });
    expect(second).toMatchObject({
      total: 3,
      nextOffset: null,
      annotations: [
        { kind: "lyric", eventId: "after", eventPath: [3], line: "1" },
        { kind: "systemText", id: "system", measureNumber: 42 },
      ],
    });
  });

  it("reports written tuplet timing while distinguishing grace and tremolo anchors", () => {
    const result = getNoteTable(scoreWithMusic(), { startMeasureId: "pickup", endMeasureId: "pickup", limit: 20 });
    const rows = result.rows as { eventId: string; onsetBeat: number; durationBeats: number | null; timing: string }[];
    expect(rows.find((row) => row.eventId === "t2")).toMatchObject({
      onsetBeat: 1 + 1 / 3,
      durationBeats: 1 / 3,
      timing: "notated",
    });
    expect(rows.find((row) => row.eventId === "grace")).toMatchObject({
      onsetBeat: 2,
      durationBeats: 0,
      timing: "graceAnchor",
    });
    expect(rows.find((row) => row.eventId === "tr2")).toMatchObject({
      onsetBeat: 3,
      durationBeats: null,
      timing: "tremoloAnchor",
    });
    expect(getNoteTable(scoreWithMusic(), { limit: 2 })).toMatchObject({ total: 8, nextOffset: 2 });
    expect(getNoteTable(scoreWithMusic(), { startMeasure: 2, includeRests: true })).toMatchObject({
      rows: [{ kind: "fullMeasureRest", measureId: "second", durationBeats: null }],
    });
  });

  it("summarizes each repeated section using the performed timeline", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          { id: "a", time: { count: 4, unit: 4 }, repeatStart: {}, tempos: [{ bpm: 120, value: { base: "quarter" } }] },
          { id: "b", repeatEnd: { times: 2 }, rehearsalMark: { text: [{ text: "B" }] } },
        ],
      },
      parts: [],
    };
    const result = getSectionTimings(score, { sections: [{ name: "B", startMeasureId: "b", endMeasureId: "b" }] });
    expect(result).toMatchObject({
      totalDurationSeconds: 8,
      sections: [
        {
          name: "B",
          start: { measureId: "b", measureOrdinal: 2 },
          performedDurationSeconds: 4,
          occurrenceCount: 2,
          occurrences: [
            { startSeconds: 2, endSeconds: 4 },
            { startSeconds: 6, endSeconds: 8 },
          ],
        },
      ],
    });
    expect(getSectionTimings(score, { limit: 1 })).toMatchObject({
      totalSections: 2,
      nextOffset: 1,
      sections: [{ start: { measureId: "a" }, end: { measureId: "a" } }],
    });
  });
});
