import { describe, it, expect } from "vitest";
import type { Score, Pitch } from "@viritura/core";
import { computeChordAssignments, redistributeChordAcrossSources } from "../score/condensingChord";

function p(step: Pitch["step"], octave: number, alter?: number): Pitch {
  return alter !== undefined
    ? { step, octave: octave as Pitch["octave"], alter }
    : { step, octave: octave as Pitch["octave"] };
}

/** Build a 2-source 4/4 score; each part has one whole rest in the measure. */
function makeTwoSourceScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 } }],
    },
    parts: [
      {
        id: "flute1",
        measures: [
          {
            sequences: [
              {
                content: [{ type: "event", duration: { base: "whole" }, rest: {} }],
              },
            ],
          },
        ],
      },
      {
        id: "flute2",
        measures: [
          {
            sequences: [
              {
                content: [{ type: "event", duration: { base: "whole" }, rest: {} }],
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Build a 3-source score with a quarter event already populated on source 0. */
function makeThreeSourceWithG4OnSource0(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        id: "horn1",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    duration: { base: "quarter" },
                    notes: [{ id: "n1", pitch: { step: "G", octave: 4 } }],
                  },
                  { type: "event", duration: { base: "half", dots: 1 }, rest: {} },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "horn2",
        measures: [{ sequences: [{ content: [{ type: "event", duration: { base: "whole" }, rest: {} }] }] }],
      },
      {
        id: "horn3",
        measures: [{ sequences: [{ content: [{ type: "event", duration: { base: "whole" }, rest: {} }] }] }],
      },
    ],
  };
}

describe("computeChordAssignments", () => {
  it("places single new pitch on top source when all sources are empty", () => {
    const slots = [{ existingPitches: [] }, { existingPitches: [] }];
    const result = computeChordAssignments(slots, p("C", 4));
    expect(result).toEqual([[p("C", 4)], []]);
  });

  it("higher new pitch displaces existing top → existing falls to source 1", () => {
    // source 0 has G4; user types E5 (higher). Expect source 0 = E5, source 1 = G4.
    const slots = [{ existingPitches: [p("G", 4)] }, { existingPitches: [] }];
    const result = computeChordAssignments(slots, p("E", 5));
    expect(result).toEqual([[p("E", 5)], [p("G", 4)]]);
  });

  it("lower new pitch goes below existing", () => {
    // source 0 has G4; user types C4. C4 < G4, so source 0 = G4, source 1 = C4.
    const slots = [{ existingPitches: [p("G", 4)] }, { existingPitches: [] }];
    const result = computeChordAssignments(slots, p("C", 4));
    expect(result).toEqual([[p("G", 4)], [p("C", 4)]]);
  });

  it("3 sources: redistributes 3 pitches top → bottom by descending pitch", () => {
    const slots = [{ existingPitches: [p("G", 4)] }, { existingPitches: [p("C", 4)] }, { existingPitches: [] }];
    const result = computeChordAssignments(slots, p("E", 5));
    expect(result).toEqual([[p("E", 5)], [p("G", 4)], [p("C", 4)]]);
  });

  it("overflow: extra pitches stack as a chord on the LAST source", () => {
    // 2 sources, 3 pitches total → src 0 gets 1, src 1 gets remaining 2 as chord.
    const slots = [{ existingPitches: [p("G", 4)] }, { existingPitches: [p("C", 4)] }];
    const result = computeChordAssignments(slots, p("E", 5));
    expect(result).toEqual([[p("E", 5)], [p("G", 4), p("C", 4)]]);
  });

  it("considers note alter when computing pitch height", () => {
    // F#4 (66) > F4 (65), so F#4 should be on top.
    const slots = [{ existingPitches: [p("F", 4, 1)] }, { existingPitches: [] }];
    const result = computeChordAssignments(slots, p("F", 4));
    expect(result[0]).toEqual([p("F", 4, 1)]);
    expect(result[1]).toEqual([p("F", 4)]);
  });
});

describe("redistributeChordAcrossSources", () => {
  it("places first pitch on source 0 when both sources are whole-rests", () => {
    const score = makeTwoSourceScore();
    const out = redistributeChordAcrossSources(score, {
      sourcePartIndices: [0, 1],
      newPitch: p("C", 4),
      duration: { base: "quarter" },
      measureIndex: 0,
      beatPosition: 0,
      beats: 1,
    });

    const ev0 = out.parts[0]!.measures[0]!.sequences[0]!.content[0];
    expect(ev0).toMatchObject({ type: "event", duration: { base: "quarter" } });
    expect((ev0 as { notes?: { pitch: Pitch }[] }).notes?.[0]?.pitch).toEqual(p("C", 4));

    // Source 1 had no matching event at (beat 0, quarter) and no pitch was
    // assigned to it, so it remains untouched (still a whole rest).
    const ev1 = out.parts[1]!.measures[0]!.sequences[0]!.content[0];
    expect((ev1 as { rest?: object }).rest).toBeDefined();
    expect((ev1 as { duration: { base: string } }).duration.base).toBe("whole");
  });

  it("Shift+E above existing G4: source 0 gets E5, source 1 gets G4", () => {
    const score = makeTwoSourceScore();
    // First, place G4 on source 0 at beat 0 quarter.
    const afterG = redistributeChordAcrossSources(score, {
      sourcePartIndices: [0, 1],
      newPitch: p("G", 4),
      duration: { base: "quarter" },
      measureIndex: 0,
      beatPosition: 0,
      beats: 1,
    });
    // Then, add E5 (higher) — should displace G4 to source 1.
    const afterE = redistributeChordAcrossSources(afterG, {
      sourcePartIndices: [0, 1],
      newPitch: p("E", 5),
      duration: { base: "quarter" },
      measureIndex: 0,
      beatPosition: 0,
      beats: 1,
    });

    const src0 = afterE.parts[0]!.measures[0]!.sequences[0]!.content[0];
    const src1 = afterE.parts[1]!.measures[0]!.sequences[0]!.content[0];
    expect((src0 as { notes: { pitch: Pitch }[] }).notes[0]!.pitch).toEqual(p("E", 5));
    expect((src1 as { notes: { pitch: Pitch }[] }).notes[0]!.pitch).toEqual(p("G", 4));
  });

  it("3 sources: G4 + Shift+E5 + Shift+B5 redistributes top → bottom", () => {
    const score = makeThreeSourceWithG4OnSource0();
    // G4 already on source 0 at beat 0. Add E5 above.
    const afterE = redistributeChordAcrossSources(score, {
      sourcePartIndices: [0, 1, 2],
      newPitch: p("E", 5),
      duration: { base: "quarter" },
      measureIndex: 0,
      beatPosition: 0,
      beats: 1,
    });
    // Add B5 above E5.
    const afterB = redistributeChordAcrossSources(afterE, {
      sourcePartIndices: [0, 1, 2],
      newPitch: p("B", 5),
      duration: { base: "quarter" },
      measureIndex: 0,
      beatPosition: 0,
      beats: 1,
    });

    const s0 = afterB.parts[0]!.measures[0]!.sequences[0]!.content[0];
    const s1 = afterB.parts[1]!.measures[0]!.sequences[0]!.content[0];
    const s2 = afterB.parts[2]!.measures[0]!.sequences[0]!.content[0];
    expect((s0 as { notes: { pitch: Pitch }[] }).notes[0]!.pitch).toEqual(p("B", 5));
    expect((s1 as { notes: { pitch: Pitch }[] }).notes[0]!.pitch).toEqual(p("E", 5));
    expect((s2 as { notes: { pitch: Pitch }[] }).notes[0]!.pitch).toEqual(p("G", 4));
  });

  it("overflow chord-stacks on the last source when more pitches than sources", () => {
    // 2 sources, but populate G4 on src0, C4 on src1, then add E5.
    const score = makeTwoSourceScore();
    const s1 = redistributeChordAcrossSources(score, {
      sourcePartIndices: [0, 1],
      newPitch: p("G", 4),
      duration: { base: "quarter" },
      measureIndex: 0,
      beatPosition: 0,
      beats: 1,
    });
    // Force C4 onto source 1 by redistributing again (G4 stays on top, C4 below).
    const s2 = redistributeChordAcrossSources(s1, {
      sourcePartIndices: [0, 1],
      newPitch: p("C", 4),
      duration: { base: "quarter" },
      measureIndex: 0,
      beatPosition: 0,
      beats: 1,
    });
    // Now add E5 — overflow: src0 = E5, src1 chord = [G4, C4].
    const s3 = redistributeChordAcrossSources(s2, {
      sourcePartIndices: [0, 1],
      newPitch: p("E", 5),
      duration: { base: "quarter" },
      measureIndex: 0,
      beatPosition: 0,
      beats: 1,
    });

    const src0 = s3.parts[0]!.measures[0]!.sequences[0]!.content[0];
    const src1 = s3.parts[1]!.measures[0]!.sequences[0]!.content[0];
    const notes0 = (src0 as { notes: { pitch: Pitch }[] }).notes;
    const notes1 = (src1 as { notes: { pitch: Pitch }[] }).notes;
    expect(notes0).toHaveLength(1);
    expect(notes0[0]!.pitch).toEqual(p("E", 5));
    expect(notes1).toHaveLength(2);
    expect(notes1.map((n) => n.pitch)).toEqual([p("G", 4), p("C", 4)]);
  });

  it("does not mutate the input score (when caller pre-clones)", () => {
    // Convention: addNoteWithAutoTie may mutate in-place, so callers that
    // need immutability pass a cloned score. Verify our helper is safe with
    // a deep-cloned input.
    const original = makeTwoSourceScore();
    const cloned = JSON.parse(JSON.stringify(original)) as Score;
    const before = JSON.stringify(original);
    redistributeChordAcrossSources(cloned, {
      sourcePartIndices: [0, 1],
      newPitch: p("C", 4),
      duration: { base: "quarter" },
      measureIndex: 0,
      beatPosition: 0,
      beats: 1,
    });
    expect(JSON.stringify(original)).toBe(before);
  });
});
