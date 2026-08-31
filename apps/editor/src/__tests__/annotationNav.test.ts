import { describe, it, expect } from "vitest";
import type { Score } from "@viritura/core";
import {
  isAnnotationId,
  getParentEventId,
  classifyAnnotationPosition,
  findAnnotationsForEvent,
  findAnnotationAbove,
  findAnnotationBelow,
  findAnnotationOtherSide,
  findNextAnnotation,
  findPrevAnnotation,
} from "../navigation/annotationNav";

/**
 * Build a minimal Score with annotations for testing.
 * Part 0, Measure 0, Sequence 0, 2 events: e0 (note with fermata+trill), e1 (note).
 * Part measure has 2 dynamics. Global measure has 1 tempo.
 */
function makeAnnotatedScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          tempos: [{ bpm: 120, value: { base: "quarter" } }],
          rehearsalMark: { text: "A" },
        },
        {},
      ],
    },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event" as const,
                    duration: { base: "quarter" as const },
                    notes: [
                      {
                        pitch: {
                          step: "C" as const,
                          octave: 4 as const,
                        },
                      },
                    ],
                    markings: {
                      trill: {},
                      staccato: {},
                      stress: {},
                    },
                    fermata: {},
                  },
                  {
                    type: "event" as const,
                    duration: { base: "quarter" as const },
                    notes: [
                      {
                        pitch: {
                          step: "D" as const,
                          octave: 4 as const,
                        },
                      },
                    ],
                  },
                ],
              },
            ],
            dynamics: [
              { id: "dyn-nav-1", type: "immediate", position: { fraction: [0, 1] as [number, number] }, value: "f" },
              { id: "dyn-nav-2", type: "immediate", position: { fraction: [1, 4] as [number, number] }, value: "p" },
              {
                id: "hairpin-nav",
                type: "gradual",
                position: { fraction: [0, 1] as [number, number] },
                end: { measure: "m1", position: { fraction: [1, 1] as [number, number] } },
                wedgeType: "increasing",
              },
            ],
          },
          {
            sequences: [
              {
                content: [
                  {
                    type: "event" as const,
                    duration: { base: "quarter" as const },
                    notes: [
                      {
                        pitch: {
                          step: "E" as const,
                          octave: 4 as const,
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as Score;
}

/** Build a simple score with no annotations. */
function makePlainScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{}],
    },
    parts: [
      {
        name: "Test",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event" as const,
                    duration: { base: "quarter" as const },
                    notes: [
                      {
                        pitch: {
                          step: "C" as const,
                          octave: 4 as const,
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as Score;
}

// ═══════════════════════════════════════════
// isAnnotationId
// ═══════════════════════════════════════════

describe("isAnnotationId", () => {
  it("returns false for event IDs", () => {
    expect(isAnnotationId("p0/m0/s0/e0")).toBe(false);
    expect(isAnnotationId("p0/m1/s0/note1")).toBe(false);
  });

  it("returns true for event-attached annotations", () => {
    expect(isAnnotationId("p0/m0/s0/e0/fermata")).toBe(true);
    expect(isAnnotationId("p0/m0/s0/e0/trill")).toBe(true);
    expect(isAnnotationId("p0/m0/s0/e0/orn0")).toBe(true);
    expect(isAnnotationId("p0/m0/s0/e0/art1")).toBe(true);
    expect(isAnnotationId("p0/m0/s0/e0/breath")).toBe(true);
    expect(isAnnotationId("p0/m0/s0/e0/arp")).toBe(true);
    expect(isAnnotationId("p0/m0/s0/e0/fing0")).toBe(true);
  });

  it("returns true for measure-level annotations", () => {
    expect(isAnnotationId("p0/m0/dyn0")).toBe(true);
    expect(isAnnotationId("p0/m0/hairpin0")).toBe(true);
    expect(isAnnotationId("p0/m0/pedal0")).toBe(true);
    expect(isAnnotationId("p0/m0/expr0")).toBe(true);
    expect(isAnnotationId("m0/tempo0")).toBe(true);
    expect(isAnnotationId("m0/rehearsal")).toBe(true);
    expect(isAnnotationId("m0/jump")).toBe(true);
  });

  it("returns false for structural elements", () => {
    // clef/key/time/barline are measure-level structural, classified as annotations
    expect(isAnnotationId("p0/m0/clef")).toBe(true);
    expect(isAnnotationId("p0/m0/barline")).toBe(true);
  });

  it("returns false for notehead sub-element IDs (regression: noteheads are not annotations)", () => {
    expect(isAnnotationId("p0/m0/s0/e0/n0")).toBe(false);
    expect(isAnnotationId("p0/m0/s0/e0/n1")).toBe(false);
    expect(isAnnotationId("p0/m1/s0/ev1/n0")).toBe(false);
  });
});

// ═══════════════════════════════════════════
// getParentEventId
// ═══════════════════════════════════════════

describe("getParentEventId", () => {
  it("returns parent event ID for event-attached annotations", () => {
    expect(getParentEventId("p0/m0/s0/e0/fermata")).toBe("p0/m0/s0/e0");
    expect(getParentEventId("p0/m1/s0/note1/trill")).toBe("p0/m1/s0/note1");
    expect(getParentEventId("p0/m0/s0/e0/art2")).toBe("p0/m0/s0/e0");
  });

  it("returns undefined for measure-level annotations", () => {
    expect(getParentEventId("p0/m0/dyn0")).toBeUndefined();
    expect(getParentEventId("m0/tempo0")).toBeUndefined();
  });

  it("returns undefined for event IDs", () => {
    expect(getParentEventId("p0/m0/s0/e0")).toBeUndefined();
  });
});

// ═══════════════════════════════════════════
// classifyAnnotationPosition
// ═══════════════════════════════════════════

describe("classifyAnnotationPosition", () => {
  it("classifies above-staff annotations", () => {
    expect(classifyAnnotationPosition("fermata")).toBe("above");
    expect(classifyAnnotationPosition("trill")).toBe("above");
    expect(classifyAnnotationPosition("tempo0")).toBe("above");
    expect(classifyAnnotationPosition("rehearsal")).toBe("above");
  });

  it("classifies below-staff annotations", () => {
    expect(classifyAnnotationPosition("dyn0")).toBe("below");
    expect(classifyAnnotationPosition("hairpin0")).toBe("below");
    expect(classifyAnnotationPosition("pedal0")).toBe("below");
    expect(classifyAnnotationPosition("expr0")).toBe("below");
  });
});

// ═══════════════════════════════════════════
// findAnnotationsForEvent
// ═══════════════════════════════════════════

describe("findAnnotationsForEvent", () => {
  it("finds event-level markings", () => {
    const score = makeAnnotatedScore();
    const annotations = findAnnotationsForEvent(score, "p0/m0/s0/e0");

    const types = annotations.map((a) => a.type);
    expect(types).toContain("fermata");
    expect(types).toContain("trill");
    expect(types).toContain("articulation"); // staccato + stress
  });

  it("finds measure-level part annotations", () => {
    const score = makeAnnotatedScore();
    const annotations = findAnnotationsForEvent(score, "p0/m0/s0/e0");

    const types = annotations.map((a) => a.type);
    expect(types).toContain("dynamic");
    expect(types).toContain("hairpin");
  });

  it("finds global annotations", () => {
    const score = makeAnnotatedScore();
    const annotations = findAnnotationsForEvent(score, "p0/m0/s0/e0");

    const types = annotations.map((a) => a.type);
    expect(types).toContain("tempo");
    expect(types).toContain("rehearsal");
  });

  it("returns empty for event with no annotations", () => {
    const score = makePlainScore();
    const annotations = findAnnotationsForEvent(score, "p0/m0/s0/e0");
    expect(annotations).toHaveLength(0);
  });

  it("returns empty for invalid event ID", () => {
    const score = makeAnnotatedScore();
    const annotations = findAnnotationsForEvent(score, "nonexistent");
    expect(annotations).toHaveLength(0);
  });

  it("sets correct parent event ID on all annotations", () => {
    const score = makeAnnotatedScore();
    const annotations = findAnnotationsForEvent(score, "p0/m0/s0/e0");
    for (const a of annotations) {
      expect(a.parentEventId).toBe("p0/m0/s0/e0");
    }
  });
});

// ═══════════════════════════════════════════
// findAnnotationAbove / findAnnotationBelow
// ═══════════════════════════════════════════

describe("findAnnotationAbove", () => {
  it("finds the first above-staff annotation", () => {
    const score = makeAnnotatedScore();
    const target = findAnnotationAbove(score, "p0/m0/s0/e0");
    expect(target).toBeDefined();
    // Should be one of the above-staff annotations (fermata, trill, etc.)
    expect(target).toMatch(/fermata|trill|art|tempo|rehearsal/);
  });

  it("returns undefined when no above annotations exist", () => {
    const score = makePlainScore();
    const target = findAnnotationAbove(score, "p0/m0/s0/e0");
    expect(target).toBeUndefined();
  });
});

describe("findAnnotationBelow", () => {
  it("finds the first below-staff annotation", () => {
    const score = makeAnnotatedScore();
    const target = findAnnotationBelow(score, "p0/m0/s0/e0");
    expect(target).toBeDefined();
    expect(target).toMatch(/dyn|hairpin|pedal|expr/);
  });

  it("returns undefined when no below annotations exist", () => {
    const score = makePlainScore();
    const target = findAnnotationBelow(score, "p0/m0/s0/e0");
    expect(target).toBeUndefined();
  });
});

// ═══════════════════════════════════════════
// findAnnotationOtherSide
// ═══════════════════════════════════════════

describe("findAnnotationOtherSide", () => {
  it("moves from above to below", () => {
    const score = makeAnnotatedScore();
    // fermata is above → should find something below
    const target = findAnnotationOtherSide(score, "p0/m0/s0/e0/fermata");
    expect(target).toBeDefined();
    expect(target).toMatch(/dyn|hairpin|pedal|expr/);
  });

  it("returns undefined when no annotations on other side", () => {
    // Score with only above-staff annotations
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{}] },
      parts: [
        {
          name: "Test",
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      type: "event" as const,
                      duration: { base: "quarter" as const },
                      notes: [{ pitch: { step: "C" as const, octave: 4 as const } }],
                      markings: {},
                      fermata: {},
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as Score;

    const target = findAnnotationOtherSide(score, "p0/m0/s0/e0/fermata");
    expect(target).toBeUndefined();
  });
});

// ═══════════════════════════════════════════
// findNextAnnotation / findPrevAnnotation
// ═══════════════════════════════════════════

describe("findNextAnnotation", () => {
  it("cycles between dynamics of same type", () => {
    const score = makeAnnotatedScore();
    // dyn0 → dyn1
    const next = findNextAnnotation(score, "p0/m0/dyndyn-nav-1");
    expect(next).toBe("p0/m0/dyndyn-nav-2");
  });

  it("wraps around to first annotation", () => {
    const score = makeAnnotatedScore();
    // dyn1 → dyn0 (wrap)
    const next = findNextAnnotation(score, "p0/m0/dyndyn-nav-2");
    expect(next).toBe("p0/m0/dyndyn-nav-1");
  });

  it("returns undefined for single annotation of type", () => {
    const score = makeAnnotatedScore();
    // Only one hairpin
    const next = findNextAnnotation(score, "p0/m0/hairpinhairpin-nav");
    expect(next).toBeUndefined();
  });
});

describe("findPrevAnnotation", () => {
  it("cycles backwards between dynamics", () => {
    const score = makeAnnotatedScore();
    // dyn0 → dyn1 (wrap backwards)
    const prev = findPrevAnnotation(score, "p0/m0/dyndyn-nav-1");
    expect(prev).toBe("p0/m0/dyndyn-nav-2");
  });

  it("moves to previous annotation of same type", () => {
    const score = makeAnnotatedScore();
    // dyn1 → dyn0
    const prev = findPrevAnnotation(score, "p0/m0/dyndyn-nav-2");
    expect(prev).toBe("p0/m0/dyndyn-nav-1");
  });
});

// ═══════════════════════════════════════════
// Event-attached annotation cycling
// ═══════════════════════════════════════════

describe("event-attached annotation cycling", () => {
  it("cycles between articulations", () => {
    const score = makeAnnotatedScore();
    // The score has staccato and stress — two separate glyphs, so two targets.
    const annotations = findAnnotationsForEvent(score, "p0/m0/s0/e0");
    const arts = annotations.filter((a) => a.type === "articulation");
    expect(arts.length).toBe(2);
    expect(arts.map((a) => a.elementId)).toEqual(["p0/m0/s0/e0/art-staccato", "p0/m0/s0/e0/art-stress"]);

    const next = findNextAnnotation(score, arts[0]!.elementId);
    expect(next).toBe(arts[1]!.elementId);

    const wrap = findNextAnnotation(score, arts[1]!.elementId);
    expect(wrap).toBe(arts[0]!.elementId);
  });

  it("treats a combo ligature as a single articulation target", () => {
    // accent + staccato collapse to one glyph, so there is one thing to
    // select — you cannot click half a ligature.
    const score = makeAnnotatedScore();
    const event = score.parts[0]!.measures[0]!.sequences[0]!.content[0] as { markings: Record<string, unknown> };
    event.markings = { accent: {}, staccato: {} };

    const arts = findAnnotationsForEvent(score, "p0/m0/s0/e0").filter((a) => a.type === "articulation");
    expect(arts).toHaveLength(1);
    expect(arts[0]!.elementId).toBe("p0/m0/s0/e0/art-accent.staccato");
  });
});
