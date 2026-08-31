import { describe, it, expect } from "vitest";
import type { Score } from "@viritura/core";
import { generateTimeline } from "../timeline";

type Step = "C" | "D" | "E" | "F" | "G" | "B" | "A";

function note(step: Step, octave: number, base: string, extra?: Record<string, unknown>) {
  return { type: "event", duration: { base }, notes: [{ pitch: { step, octave } }], ...extra };
}

/** quarter-note seconds at 120 bpm. */
const Q = 0.5;
// Onset/offset times carry deterministic ±15ms humanization jitter, so all
// time assertions use a 50ms tolerance (precision 1). The hold shifts under
// test are ≥0.25s, comfortably above the jitter floor.
const PREC = 1;

/**
 * Build a one-part score from per-measure content arrays. Each measure is a
 * list of content items. All measures 4/4 @ 120 bpm.
 */
function buildScore(measures: object[][], globalExtra: object[] = []): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: measures.map((_, i) => ({
        time: { count: 4, unit: 4 },
        tempos: [{ bpm: 120, value: { base: "quarter" } } as never],
        ...(globalExtra[i] ?? {}),
      })),
    },
    parts: [
      {
        id: "p1",
        name: "Violin",
        measures: measures.map((content) => ({ sequences: [{ content }] })),
      } as never,
    ],
  };
}

function noteOns(tl: ReturnType<typeof generateTimeline>) {
  return tl.events.filter((e) => e.type === "noteOn");
}
function noteOffs(tl: ReturnType<typeof generateTimeline>) {
  return tl.events.filter((e) => e.type === "noteOff");
}
function onsetTimes(tl: ReturnType<typeof generateTimeline>) {
  return noteOns(tl).map((e) => e.time);
}

describe("generateTimeline — fermata holds", () => {
  it("extends the held note's noteOff by the fermata multiplier", () => {
    // Whole-note C5 with a normal fermata (×2) → sounds ~2 whole notes.
    const tl = generateTimeline(buildScore([[note("C", 5, "whole", { fermata: {} })]]));
    const off = noteOffs(tl)[0]!;
    // Whole note = 4 quarters = 2s; ×2 = 4s.
    expect(off.time).toBeCloseTo(4 * Q * 2, PREC);
  });

  it("respects the fermata duration hint (long = ×2.5)", () => {
    const tl = generateTimeline(buildScore([[note("C", 5, "whole", { fermata: { duration: "long" } })]]));
    const off = noteOffs(tl)[0]!;
    expect(off.time).toBeCloseTo(2.0 * 2.5, PREC); // 2s × 2.5
  });

  it("shifts a following note in the same measure by the hold", () => {
    // Half-note C5 (fermata ×2) then half-note D5. Hold inserts 1 half = 1s.
    const tl = generateTimeline(buildScore([[note("C", 5, "half", { fermata: {} }), note("D", 5, "half")]]));
    const times = onsetTimes(tl);
    // Note 1 at 0; note 2 normally at 1s, shifted by (2-1)*1s = +1s → 2s.
    expect(times[0]).toBeCloseTo(0, PREC);
    expect(times[1]).toBeCloseTo(2.0, PREC);
  });

  it("shifts all subsequent measures by the hold", () => {
    // M1: whole-note C5 fermata ×2 (inserts +2s). M2: whole-note D5.
    const tl = generateTimeline(buildScore([[note("C", 5, "whole", { fermata: {} })], [note("D", 5, "whole")]]));
    const times = onsetTimes(tl);
    // M2 normally at 2s; +2s hold → 4s.
    expect(times[1]).toBeCloseTo(4.0, PREC);
  });

  it("the held noteOff meets the next note's shifted onset (no gap)", () => {
    const tl = generateTimeline(buildScore([[note("C", 5, "half", { fermata: {} }), note("D", 5, "half")]]));
    const off1 = noteOffs(tl).find((e) => e.midiNote === 72)!; // C5
    const on2 = noteOns(tl).find((e) => e.midiNote === 74)!; // D5
    expect(off1.time).toBeCloseTo(on2.time, PREC);
  });

  it("duration 'none' inserts no hold", () => {
    const tl = generateTimeline(
      buildScore([[note("C", 5, "half", { fermata: { duration: "none" } }), note("D", 5, "half")]]),
    );
    expect(onsetTimes(tl)[1]).toBeCloseTo(1.0, PREC); // unshifted
  });

  it("aligns parts: a fermata in one part shifts the other part too", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          { time: { count: 4, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" } } as never] },
          { time: { count: 4, unit: 4 } },
        ],
      },
      parts: [
        {
          id: "p1",
          name: "Violin",
          measures: [
            { sequences: [{ content: [note("C", 5, "whole", { fermata: {} })] }] },
            { sequences: [{ content: [note("E", 5, "whole")] }] },
          ],
        } as never,
        // Part 2 has NO fermata, but must still wait.
        {
          id: "p2",
          name: "Cello",
          measures: [
            { sequences: [{ content: [note("C", 3, "whole")] }] },
            { sequences: [{ content: [note("E", 3, "whole")] }] },
          ],
        } as never,
      ],
    };
    const tl = generateTimeline(score, { partPrograms: [40, 42] });
    // Both parts' measure-2 notes (E5=76, E3=52) start at 4s (2s + 2s hold).
    const e5 = noteOns(tl).find((e) => e.midiNote === 76)!;
    const e3 = noteOns(tl).find((e) => e.midiNote === 52)!;
    expect(e5.time).toBeCloseTo(4.0, PREC);
    expect(e3.time).toBeCloseTo(4.0, PREC);
  });
});

describe("generateTimeline — caesura pauses", () => {
  it("inserts silence after the carrier without extending it", () => {
    // Quarter C5 with caesura, then quarter D5. Caesura = 1 beat = 0.5s.
    const tl = generateTimeline(
      buildScore([[note("C", 5, "quarter", { markings: { caesura: {} } }), note("D", 5, "quarter")]]),
    );
    const offC = noteOffs(tl).find((e) => e.midiNote === 72)!;
    const onD = noteOns(tl).find((e) => e.midiNote === 74)!;
    // Carrier C5 ends at its natural ~0.45s (0.9 scale), NOT extended.
    expect(offC.time).toBeLessThan(Q + 0.05);
    // D5 normally at 0.5s; +1 beat (0.5s) caesura → 1.0s.
    expect(onD.time).toBeCloseTo(1.0, PREC);
  });

  it("a short caesura inserts half a beat", () => {
    const tl = generateTimeline(
      buildScore([[note("C", 5, "quarter", { markings: { caesura: { style: "short" } } }), note("D", 5, "quarter")]]),
    );
    const onD = noteOns(tl).find((e) => e.midiNote === 74)!;
    // 0.5s + 0.5 beat (0.25s) → 0.75s.
    expect(onD.time).toBeCloseTo(0.75, PREC);
  });

  it("a global measure caesura pauses at the measure end", () => {
    // M1 four quarters + global caesura; M2 one whole note.
    const tl = generateTimeline(
      buildScore(
        [
          [note("C", 5, "quarter"), note("C", 5, "quarter"), note("C", 5, "quarter"), note("C", 5, "quarter")],
          [note("D", 5, "whole")],
        ],
        [{ caesura: {} }, {}],
      ),
    );
    const onD = noteOns(tl).find((e) => e.midiNote === 74)!;
    // M2 normally at 2s; +1 beat (0.5s) → 2.5s.
    expect(onD.time).toBeCloseTo(2.5, PREC);
  });

  it("no holds → onsets are unchanged", () => {
    const tl = generateTimeline(buildScore([[note("C", 5, "half"), note("D", 5, "half")]]));
    const times = onsetTimes(tl);
    expect(times[0]).toBeCloseTo(0, PREC);
    expect(times[1]).toBeCloseTo(1.0, PREC);
  });
});

describe("generateTimeline — mixed-duration fermatas (ensemble alignment)", () => {
  // When a bar carries fermatas on notes of different durations, the SHORTEST
  // fermata'd note drives the hold (it reveals the true ensemble hold); the
  // longer fermata'd notes merely coexist as a hint and sustain to the same
  // release. They must NOT each double their own (long) duration.
  function mixedFermataScore(): Score {
    return {
      mnx: { version: 1 },
      global: {
        measures: [
          { time: { count: 4, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" } } as never] },
          { time: { count: 4, unit: 4 } },
        ],
      },
      parts: [
        {
          id: "vln",
          name: "Violin",
          measures: [
            { sequences: [{ content: [note("C", 5, "whole", { fermata: {} })] }] },
            { sequences: [{ content: [note("G", 5, "whole")] }] },
          ],
        } as never,
        {
          id: "vc",
          name: "Cello",
          // Half-note fermata (beats 0–2), then a half rest (beats 2–4).
          measures: [
            {
              sequences: [
                {
                  content: [
                    note("C", 3, "half", { fermata: {} }),
                    { type: "event", duration: { base: "half" }, rest: {} },
                  ],
                },
              ],
            },
            { sequences: [{ content: [note("G", 3, "whole")] }] },
          ],
        } as never,
      ],
    };
  }

  it("drives the hold from the SHORTEST fermata, not the longest", () => {
    const tl = generateTimeline(mixedFermataScore(), { partPrograms: [40, 42] });
    // Shortest fermata = the half note (2 beats ×2 → +2 beats = +1s). The whole
    // note must NOT double its own 4 beats. M2 onset: 2s + 1s = 3s.
    const g5 = noteOns(tl).find((e) => e.midiNote === 79)!; // G5, part 1 M2
    const g3 = noteOns(tl).find((e) => e.midiNote === 55)!; // G3, part 2 M2
    expect(g5.time).toBeCloseTo(3.0, PREC);
    expect(g3.time).toBeCloseTo(3.0, PREC);
  });

  it("extends each fermata note IN PLACE, not to a unified bar-end release", () => {
    const tl = generateTimeline(mixedFermataScore(), { partPrograms: [40, 42] });
    const offC5 = noteOffs(tl).find((e) => e.midiNote === 72)!; // C5 whole (part 1)
    const offC3 = noteOffs(tl).find((e) => e.midiNote === 48)!; // C3 half (part 2)
    // The hold (+2 beats = 1s) is inserted at the DRIVING half note's end (beat
    // 2). The half note (driver) is held ~×2 in place → ends at beat 4 = 2s.
    // The whole note rings THROUGH the inserted hold → its natural 2s + 1s = 3s.
    // They do NOT cut to a single common release; each extends where it sits.
    expect(offC3.time).toBeCloseTo(2.0, PREC);
    expect(offC5.time).toBeCloseTo(3.0, PREC);
  });

  it("a short fermata inside held whole notes holds only its own length", () => {
    // Canonical case: most parts hold a whole-note fermata; one part subdivides
    // the bar and fermatas the LAST quarter. The hold is one doubled quarter
    // (+1 beat), NOT a doubled whole note (+4 beats). All resolve at the bar end.
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          { time: { count: 4, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" } } as never] },
          { time: { count: 4, unit: 4 } },
        ],
      },
      parts: [
        {
          id: "held",
          name: "Violin",
          measures: [
            { sequences: [{ content: [note("C", 5, "whole", { fermata: {} })] }] },
            { sequences: [{ content: [note("G", 5, "whole")] }] },
          ],
        } as never,
        {
          id: "subdiv",
          name: "Viola",
          measures: [
            {
              sequences: [
                {
                  content: [
                    note("E", 4, "quarter"),
                    note("E", 4, "quarter"),
                    note("E", 4, "quarter"),
                    note("E", 4, "quarter", { fermata: {} }),
                  ],
                },
              ],
            },
            { sequences: [{ content: [note("G", 4, "whole")] }] },
          ],
        } as never,
      ],
    };
    const tl = generateTimeline(score, { partPrograms: [40, 41] });
    // Quarter fermata ×2 → +1 beat (0.5s). M2 onset: 2s + 0.5s = 2.5s.
    const g5 = noteOns(tl).find((e) => e.midiNote === 79)!;
    const g4 = noteOns(tl).find((e) => e.midiNote === 67)!;
    expect(g5.time).toBeCloseTo(2.5, PREC);
    expect(g4.time).toBeCloseTo(2.5, PREC);
    // The held whole note resolves at the same 2.5s — it is NOT doubled to 4s.
    const offC5 = noteOffs(tl).find((e) => e.midiNote === 72)!;
    expect(offC5.time).toBeCloseTo(2.5, PREC);
  });

  it("uses the shortest note's own fermata-duration hint", () => {
    // Part 1: half note, LONG fermata (×2.5). Part 2: whole note, normal (×2).
    // The half is the shortest, so its ×2.5 drives: (2.5-1)×2 beats = +3 beats
    // = +1.5s. M2 onset: 2s + 1.5s = 3.5s. (Old "longest extension" rule gave 4s.)
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          { time: { count: 4, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" } } as never] },
          { time: { count: 4, unit: 4 } },
        ],
      },
      parts: [
        {
          id: "a",
          name: "Violin",
          measures: [
            {
              sequences: [
                {
                  content: [
                    note("C", 5, "half", { fermata: { duration: "long" } }),
                    { type: "event", duration: { base: "half" }, rest: {} },
                  ],
                },
              ],
            },
            { sequences: [{ content: [note("G", 5, "whole")] }] },
          ],
        } as never,
        {
          id: "b",
          name: "Viola",
          measures: [
            { sequences: [{ content: [note("C", 4, "whole", { fermata: {} })] }] },
            { sequences: [{ content: [note("G", 4, "whole")] }] },
          ],
        } as never,
      ],
    };
    const tl = generateTimeline(score, { partPrograms: [40, 41] });
    const g5 = noteOns(tl).find((e) => e.midiNote === 79)!;
    const g4 = noteOns(tl).find((e) => e.midiNote === 67)!;
    expect(g5.time).toBeCloseTo(3.5, PREC);
    expect(g4.time).toBeCloseTo(3.5, PREC);
  });
});

describe("generateTimeline — fermata grouping by overlapping spans", () => {
  it("two non-overlapping fermatas in one bar insert TWO separate holds", () => {
    // Bar: quarter fermata (beat 0), two quarters, quarter fermata (beat 3),
    // then a follow-up bar. The two fermatas don't overlap → two distinct holds
    // of +1 beat each (0.5s). M2 onset: 2s + 0.5 + 0.5 = 3.0s.
    const tl = generateTimeline(
      buildScore([
        [
          note("C", 5, "quarter", { fermata: {} }),
          note("D", 5, "quarter"),
          note("E", 5, "quarter"),
          note("F", 5, "quarter", { fermata: {} }),
        ],
        [note("G", 5, "whole")],
      ]),
    );
    const onsets = onsetTimes(tl);
    // Note 1 (beat0) at 0. Note 2 (beat1): shifted by hold1 (+0.5) → 1.0s.
    expect(onsets[1]).toBeCloseTo(1.0, PREC);
    // M2 (G5) after both holds: 2s + 0.5 + 0.5 = 3.0s.
    const g5 = noteOns(tl).find((e) => e.midiNote === 79)!;
    expect(g5.time).toBeCloseTo(3.0, PREC);
  });

  it("each disjoint fermata carrier resumes at its OWN group", () => {
    const tl = generateTimeline(
      buildScore([
        [
          note("C", 5, "quarter", { fermata: {} }),
          note("D", 5, "quarter"),
          note("E", 5, "quarter"),
          note("F", 5, "quarter", { fermata: {} }),
        ],
      ]),
    );
    // First fermata quarter (C5=72) doubles in place: ends at ~1.0s (0.5 + 0.5 hold).
    const offC = noteOffs(tl).find((e) => e.midiNote === 72)!;
    expect(offC.time).toBeCloseTo(1.0, PREC);
    // Last fermata quarter (F5=77): onset at beat3 shifted by hold1 (+0.5) → 2.0s;
    // its own ×2 hold doubles its 0.5s length → ends at 3.0s.
    const onF = noteOns(tl).find((e) => e.midiNote === 77)!;
    const offF = noteOffs(tl).find((e) => e.midiNote === 77)!;
    expect(onF.time).toBeCloseTo(2.0, PREC);
    expect(offF.time).toBeCloseTo(3.0, PREC);
  });

  it("an overlapping (bridged) span stays ONE hold", () => {
    // Whole-note fermata spans the whole bar; a quarter fermata on beat 3 sits
    // under it → they overlap → ONE group. Shortest (quarter ×2) drives: +1 beat.
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          { time: { count: 4, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" } } as never] },
          { time: { count: 4, unit: 4 } },
        ],
      },
      parts: [
        {
          id: "held",
          name: "Violin",
          measures: [
            { sequences: [{ content: [note("C", 5, "whole", { fermata: {} })] }] },
            { sequences: [{ content: [note("G", 5, "whole")] }] },
          ],
        } as never,
        {
          id: "sub",
          name: "Viola",
          measures: [
            {
              sequences: [
                {
                  content: [
                    note("E", 4, "quarter"),
                    note("E", 4, "quarter"),
                    note("E", 4, "quarter"),
                    note("E", 4, "quarter", { fermata: {} }),
                  ],
                },
              ],
            },
            { sequences: [{ content: [note("G", 4, "whole")] }] },
          ],
        } as never,
      ],
    };
    const tl = generateTimeline(score, { partPrograms: [40, 41] });
    // Single merged group, +1 beat (0.5s). M2 at 2s + 0.5 = 2.5s (NOT 3.0s).
    const g5 = noteOns(tl).find((e) => e.midiNote === 79)!;
    expect(g5.time).toBeCloseTo(2.5, PREC);
  });

  it("a fermata on a note INSIDE a tuplet drives the (scaled) shortest hold", () => {
    // Mirrors the Rhapsody clarinet bar before reh. 1: most parts hold a
    // whole-note fermata [0,4), while the clarinet solo's fermata sits on a
    // triplet eighth (3 eighths in the space of 2 → each ~0.333 beats) at the
    // back half of the bar. The triplet eighth is the SHORTEST span and must
    // drive the hold: +(2-1)*0.333 = +0.333 beats (≈0.167s), NOT the whole bar.
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          { time: { count: 4, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" } } as never] },
          { time: { count: 4, unit: 4 } },
        ],
      },
      parts: [
        {
          id: "held",
          name: "Violin",
          measures: [
            { sequences: [{ content: [note("C", 5, "whole", { fermata: {} })] }] },
            { sequences: [{ content: [note("B", 5, "whole")] }] },
          ],
        } as never,
        {
          id: "clarinet",
          name: "Clarinet",
          measures: [
            {
              sequences: [
                {
                  content: [
                    note("C", 5, "half"),
                    note("D", 5, "quarter"),
                    {
                      type: "tuplet",
                      inner: { multiple: 3, duration: { base: "eighth" } },
                      outer: { multiple: 2, duration: { base: "eighth" } },
                      content: [
                        note("E", 5, "eighth"),
                        note("F", 5, "eighth"),
                        note("G", 5, "eighth", { fermata: {} }),
                      ],
                    },
                  ],
                },
              ],
            },
            { sequences: [{ content: [note("B", 4, "whole")] }] },
          ],
        } as never,
      ],
    };
    const tl = generateTimeline(score, { partPrograms: [40, 41] });
    // Triplet eighth ≈ 0.333 beats; ×2 hold = +0.333 beats = +0.167s.
    // M2 onset: 2s + 0.167s ≈ 2.17s. Crucially NOT 4s (whole-note doubled).
    // M2 uses B (83/71) so it isn't confused with the M1 triplet G5 (79).
    const b5 = noteOns(tl).find((e) => e.midiNote === 83)!;
    expect(b5.time).toBeCloseTo(2.17, PREC);
    expect(b5.time).toBeLessThan(2.5);
  });

  it("a SLURRED fermata note still rings through its hold (slur doesn't pin it)", () => {
    // A fermata note that is also the start of a slur must hold for its
    // extended (fermata) duration — the legato resolver must NOT pin its
    // release to the next note's onset (which would drop the held time).
    const tl = generateTimeline(
      buildScore([
        [
          note("C", 5, "half", { fermata: {}, slurs: [{ target: "n2" }] }),
          { type: "event", duration: { base: "half" }, id: "n2", notes: [{ pitch: { step: "D", octave: 5 } }] },
        ],
      ]),
    );
    // Half note (2 beats = 1s) ×2 fermata → rings ~2s (its 1s + 1s hold).
    const onC = noteOns(tl).find((e) => e.midiNote === 72)!;
    const offC = noteOffs(tl).find((e) => e.midiNote === 72)!;
    expect(onC.time).toBeCloseTo(0, PREC);
    // Held duration ≈ 2s — NOT cut to ~1s (the next note's onset).
    expect(offC.time - onC.time).toBeCloseTo(2.0, PREC);
  });
});
