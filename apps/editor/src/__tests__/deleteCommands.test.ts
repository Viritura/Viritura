import { describe, it, expect } from "vitest";
import type { Score, NoteEvent } from "@viritura/core";
import type { Step, Octave } from "@viritura/core";
import { deleteAnnotation, deleteAnnotations, expandCondensedDynamicLocations } from "../commands/deleteCommands";
import { resolveEventLocation, resolveAnnotationLocation } from "../score/ElementPath";

// ═══════════════════════════════════════════
// Test helpers
// ═══════════════════════════════════════════

function makeNote(
  id: string,
  base: "whole" | "half" | "quarter" | "eighth",
  step: Step = "C",
  octave: Octave = 4,
): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base },
    notes: [{ pitch: { step, octave } }],
  };
}

/** Create a score with one part, one measure, one voice containing the given events. */
function makeScore(events: NoteEvent[]): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 } }],
    },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [{ content: events }],
          },
        ],
      },
    ],
  };
}

// ═══════════════════════════════════════════
// resolveEventLocation
// ═══════════════════════════════════════════

describe("resolveEventLocation", () => {
  it("parses a valid event element ID", () => {
    const score = makeScore([makeNote("ev1", "quarter")]);
    const loc = resolveEventLocation("p0/m0/s0/ev1", score);
    expect(loc).toEqual({
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
    });
  });

  it("returns null for non-event IDs (clef, key, time)", () => {
    const score = makeScore([makeNote("ev1", "quarter")]);
    expect(resolveEventLocation("p0/m0/clef", score)).toBeNull();
    expect(resolveEventLocation("p0/m0/key", score)).toBeNull();
    expect(resolveEventLocation("m0/time", score)).toBeNull();
  });

  it("returns null for invalid element ID format", () => {
    const score = makeScore([makeNote("ev1", "quarter")]);
    expect(resolveEventLocation("", score)).toBeNull();
    expect(resolveEventLocation("invalid", score)).toBeNull();
    expect(resolveEventLocation("p0/m0", score)).toBeNull();
  });

  it("returns null when event ID not found in sequence", () => {
    const score = makeScore([makeNote("ev1", "quarter")]);
    expect(resolveEventLocation("p0/m0/s0/nonexistent", score)).toBeNull();
  });

  it("returns null for out-of-range part/measure/sequence", () => {
    const score = makeScore([makeNote("ev1", "quarter")]);
    expect(resolveEventLocation("p9/m0/s0/ev1", score)).toBeNull();
    expect(resolveEventLocation("p0/m9/s0/ev1", score)).toBeNull();
    expect(resolveEventLocation("p0/m0/s9/ev1", score)).toBeNull();
  });
});

// ═══════════════════════════════════════════
// resolveAnnotationLocation
// ═══════════════════════════════════════════

describe("resolveAnnotationLocation", () => {
  describe("part-level annotations", () => {
    it("parses a dynamic annotation ID", () => {
      const loc = resolveAnnotationLocation("p0/m2/dyn0");
      expect(loc).toEqual({
        kind: "part",
        type: "dyn",
        measureIndex: 2,
        partIndex: 0,
        annotationIndex: 0,
      });
    });

    it("parses a text expression ID", () => {
      const loc = resolveAnnotationLocation("p1/m3/expr2");
      expect(loc).toEqual({
        kind: "part",
        type: "expr",
        measureIndex: 3,
        partIndex: 1,
        annotationIndex: 2,
      });
    });

    it("parses a chord symbol ID", () => {
      const loc = resolveAnnotationLocation("p0/m0/chord1");
      expect(loc).toEqual({
        kind: "part",
        type: "chord",
        measureIndex: 0,
        partIndex: 0,
        annotationIndex: 1,
      });
    });

    it("parses a hairpin ID", () => {
      const loc = resolveAnnotationLocation("p0/m1/hairpin0");
      expect(loc).toEqual({
        kind: "part",
        type: "hairpin",
        measureIndex: 1,
        partIndex: 0,
        annotationIndex: 0,
      });
    });

    it("parses a pedal ID", () => {
      const loc = resolveAnnotationLocation("p0/m0/pedal0");
      expect(loc).toEqual({
        kind: "part",
        type: "pedal",
        measureIndex: 0,
        partIndex: 0,
        annotationIndex: 0,
      });
    });

    it("parses an ottava ID", () => {
      const loc = resolveAnnotationLocation("p0/m0/ottava0");
      expect(loc).toEqual({
        kind: "part",
        type: "ottava",
        measureIndex: 0,
        partIndex: 0,
        annotationIndex: 0,
      });
    });
  });

  describe("global-level annotations", () => {
    it("parses a tempo annotation ID", () => {
      const loc = resolveAnnotationLocation("m0/tempo0");
      expect(loc).toEqual({
        kind: "global",
        type: "tempo",
        measureIndex: 0,
        annotationIndex: 0,
      });
    });

    it("parses a segno annotation ID", () => {
      const loc = resolveAnnotationLocation("m2/segno");
      expect(loc).toEqual({
        kind: "global",
        type: "segno",
        measureIndex: 2,
      });
    });

    it("parses a fine annotation ID", () => {
      const loc = resolveAnnotationLocation("m3/fine");
      expect(loc).toEqual({
        kind: "global",
        type: "fine",
        measureIndex: 3,
      });
    });

    it("parses a jump annotation ID", () => {
      const loc = resolveAnnotationLocation("m1/jump");
      expect(loc).toEqual({
        kind: "global",
        type: "jump",
        measureIndex: 1,
      });
    });

    it("parses a coda annotation ID", () => {
      const loc = resolveAnnotationLocation("m0/coda");
      expect(loc).toEqual({
        kind: "global",
        type: "coda",
        measureIndex: 0,
      });
    });

    it("parses a rehearsal mark annotation ID", () => {
      const loc = resolveAnnotationLocation("m0/rehearsal");
      expect(loc).toEqual({
        kind: "global",
        type: "rehearsal",
        measureIndex: 0,
      });
    });
  });

  describe("non-annotation IDs", () => {
    it("returns null for event IDs", () => {
      expect(resolveAnnotationLocation("p0/m0/s0/ev1")).toBeNull();
    });

    it("returns null for clef/key/barline IDs", () => {
      expect(resolveAnnotationLocation("p0/m0/clef")).toBeNull();
      expect(resolveAnnotationLocation("p0/m0/key")).toBeNull();
      expect(resolveAnnotationLocation("p0/m0/barline")).toBeNull();
    });

    it("returns null for time signature IDs", () => {
      expect(resolveAnnotationLocation("m0/time")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(resolveAnnotationLocation("")).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════
// deleteAnnotation
// ═══════════════════════════════════════════

describe("deleteAnnotation", () => {
  /** Score with various annotations. */
  function makeAnnotatedScore(): Score {
    return {
      mnx: { version: 1 },
      global: {
        measures: [
          {
            time: { count: 4, unit: 4 },
            tempos: [{ bpm: 120, value: { base: "quarter" } }],
            segno: { location: { fraction: [0, 1] } },
            fine: { location: { fraction: [0, 1] } },
            jump: { type: "segno", location: { fraction: [0, 1] } },
            rehearsalMark: { text: "A" },
            coda: { location: { fraction: [0, 1] } },
          },
          {},
        ],
      },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              sequences: [{ content: [makeNote("ev1", "whole")] }],
              dynamics: [
                { id: "dyn-delete-1", type: "immediate", position: { fraction: [0, 1] }, value: "f" },
                { id: "dyn-delete-2", type: "immediate", position: { fraction: [1, 2] }, value: "p" },
                {
                  id: "hairpin-delete",
                  type: "gradual",
                  position: { fraction: [0, 1] },
                  end: { measure: "m1", position: { fraction: [1, 1] } },
                  wedgeType: "increasing",
                },
              ],
              expressions: [{ text: "dolce", position: { fraction: [0, 1] } }],
              chordSymbols: [{ position: { fraction: [0, 1] }, root: { step: "C" }, quality: "major" }],
              pedals: [
                {
                  type: "sustain",
                  position: { fraction: [0, 1] },
                  end: { measure: "m1", position: { fraction: [1, 1] } },
                },
              ],
              ottavas: [
                { value: 8, position: { fraction: [0, 1] }, end: { measure: "m1", position: { fraction: [1, 1] } } },
              ],
            },
            {
              sequences: [{ content: [makeNote("ev2", "whole")] }],
            },
          ],
        },
      ],
    };
  }

  describe("global annotations", () => {
    it("deletes a tempo marking", () => {
      const score = makeAnnotatedScore();
      const result = deleteAnnotation(score, { kind: "global", type: "tempo", measureIndex: 0, annotationIndex: 0 });
      expect(result).not.toBeNull();
      expect(result!.global.measures[0]!.tempos).toBeUndefined();
    });

    it("deletes a segno marker", () => {
      const score = makeAnnotatedScore();
      const result = deleteAnnotation(score, { kind: "global", type: "segno", measureIndex: 0 });
      expect(result).not.toBeNull();
      expect(result!.global.measures[0]!.segno).toBeUndefined();
    });

    it("deletes a fine marker", () => {
      const score = makeAnnotatedScore();
      const result = deleteAnnotation(score, { kind: "global", type: "fine", measureIndex: 0 });
      expect(result).not.toBeNull();
      expect(result!.global.measures[0]!.fine).toBeUndefined();
    });

    it("deletes a jump marker", () => {
      const score = makeAnnotatedScore();
      const result = deleteAnnotation(score, { kind: "global", type: "jump", measureIndex: 0 });
      expect(result).not.toBeNull();
      expect(result!.global.measures[0]!.jump).toBeUndefined();
    });

    it("deletes a coda marker", () => {
      const score = makeAnnotatedScore();
      const result = deleteAnnotation(score, { kind: "global", type: "coda", measureIndex: 0 });
      expect(result).not.toBeNull();
      expect(result!.global.measures[0]!.coda).toBeUndefined();
    });

    it("deletes a rehearsal mark", () => {
      const score = makeAnnotatedScore();
      const result = deleteAnnotation(score, { kind: "global", type: "rehearsal", measureIndex: 0 });
      expect(result).not.toBeNull();
      expect(result!.global.measures[0]!.rehearsalMark).toBeUndefined();
    });

    it("returns null for invalid measure index", () => {
      const score = makeAnnotatedScore();
      const result = deleteAnnotation(score, { kind: "global", type: "segno", measureIndex: 99 });
      expect(result).toBeNull();
    });

    it("returns null when annotation not present", () => {
      const score = makeAnnotatedScore();
      const result = deleteAnnotation(score, { kind: "global", type: "segno", measureIndex: 1 });
      expect(result).toBeNull();
    });
  });

  describe("part-level annotations", () => {
    it("deletes one dynamic from an array", () => {
      const score = makeAnnotatedScore();
      const result = deleteAnnotation(score, {
        kind: "part",
        type: "dyn",
        measureIndex: 0,
        partIndex: 0,
        annotationIndex: 0,
      });
      expect(result).not.toBeNull();
      const dynamics = result!.parts[0]!.measures[0]!.dynamics!.filter((group) => group.type !== "gradual");
      expect(dynamics).toHaveLength(1);
      expect(dynamics[0]!.value).toBe("p");
    });

    it("removes the last immediate dynamic while preserving gradual groups", () => {
      const score = makeAnnotatedScore();
      // Delete the second dynamic
      let result = deleteAnnotation(score, {
        kind: "part",
        type: "dyn",
        measureIndex: 0,
        partIndex: 0,
        annotationIndex: 1,
      });
      expect(result).not.toBeNull();
      expect(result!.parts[0]!.measures[0]!.dynamics!.filter((group) => group.type !== "gradual")).toHaveLength(1);
      // Delete the remaining dynamic
      result = deleteAnnotation(result!, {
        kind: "part",
        type: "dyn",
        measureIndex: 0,
        partIndex: 0,
        annotationIndex: 0,
      });
      expect(result).not.toBeNull();
      expect(result!.parts[0]!.measures[0]!.dynamics).toHaveLength(1);
      expect(result!.parts[0]!.measures[0]!.dynamics![0]!.type).toBe("gradual");
    });

    it("deletes a dynamic addressed by group id", () => {
      const score = makeAnnotatedScore();
      const result = deleteAnnotation(score, {
        kind: "part",
        type: "dyn",
        measureIndex: 0,
        partIndex: 0,
        annotationId: "dyn-delete-2",
      });
      expect(result).not.toBeNull();
      const ids = result!.parts[0]!.measures[0]!.dynamics!.map((group) => group.id);
      expect(ids).toEqual(["dyn-delete-1", "hairpin-delete"]);
    });

    it("deletes a hairpin addressed by group id", () => {
      const score = makeAnnotatedScore();
      const result = deleteAnnotation(score, {
        kind: "part",
        type: "hairpin",
        measureIndex: 0,
        partIndex: 0,
        annotationId: "hairpin-delete",
      });
      expect(result).not.toBeNull();
      const ids = result!.parts[0]!.measures[0]!.dynamics!.map((group) => group.id);
      expect(ids).toEqual(["dyn-delete-1", "dyn-delete-2"]);
    });

    it("returns null when the group id does not match any dynamic", () => {
      const score = makeAnnotatedScore();
      const result = deleteAnnotation(score, {
        kind: "part",
        type: "dyn",
        measureIndex: 0,
        partIndex: 0,
        annotationId: "not-here",
      });
      expect(result).toBeNull();
    });

    it("deletes matching dynamic groups from every source on the active condensed staff", () => {
      const score = makeAnnotatedScore();
      const secondPart = structuredClone(score.parts[0]!);
      secondPart.id = "part-2";
      secondPart.name = "Flute 2";
      secondPart.measures[0]!.dynamics![0]!.id = "part-2-dyn-1";
      secondPart.measures[0]!.dynamics![1]!.id = "part-2-dyn-2";
      secondPart.measures[0]!.dynamics![2]!.id = "part-2-hairpin";
      secondPart.measures[0]!.dynamics![2]!.visuallyContinues = "part-2-dyn-1";
      score.parts[0]!.id = "part-1";
      score.parts[0]!.measures[0]!.dynamics![2]!.visuallyContinues = "dyn-delete-1";
      score.parts.push(secondPart);
      score.layouts = [
        {
          id: "condensed",
          content: [{ type: "staff", sources: [{ part: "part-1" }, { part: "part-2" }] }],
        },
      ];
      score.scores = [{ name: "Condensed", layout: "condensed" }];

      const result = deleteAnnotation(
        score,
        {
          kind: "part",
          type: "dyn",
          measureIndex: 0,
          partIndex: 0,
          annotationId: "dyn-delete-1",
        },
        0,
      );

      expect(result).not.toBeNull();
      expect(result!.parts[0]!.measures[0]!.dynamics!.map((group) => group.id)).toEqual([
        "dyn-delete-2",
        "hairpin-delete",
      ]);
      expect(result!.parts[1]!.measures[0]!.dynamics!.map((group) => group.id)).toEqual([
        "part-2-dyn-2",
        "part-2-hairpin",
      ]);
      expect(result!.parts[0]!.measures[0]!.dynamics![1]!.visuallyContinues).toBeUndefined();
      expect(result!.parts[1]!.measures[0]!.dynamics![1]!.visuallyContinues).toBeUndefined();
    });

    it("expands multiple selected condensed groups across every source before deleting", () => {
      const score = makeAnnotatedScore();
      score.parts[0]!.id = "part-1";
      const secondPart = structuredClone(score.parts[0]!);
      secondPart.id = "part-2";
      secondPart.measures[0]!.dynamics![0]!.id = "part-2-dyn-1";
      secondPart.measures[0]!.dynamics![1]!.id = "part-2-dyn-2";
      secondPart.measures[0]!.dynamics![2]!.id = "part-2-hairpin";
      score.parts.push(secondPart);
      score.layouts = [
        {
          id: "condensed",
          content: [{ type: "staff", sources: [{ part: "part-1" }, { part: "part-2" }] }],
        },
      ];
      score.scores = [{ name: "Condensed", layout: "condensed" }];
      const selected = [
        { kind: "part", type: "dyn", measureIndex: 0, partIndex: 0, annotationId: "dyn-delete-1" },
        { kind: "part", type: "dyn", measureIndex: 0, partIndex: 0, annotationId: "dyn-delete-2" },
      ] as const;

      const expanded = expandCondensedDynamicLocations(score, selected, 0);
      const result = deleteAnnotations(score, expanded);

      expect(expanded).toHaveLength(4);
      expect(result!.parts[0]!.measures[0]!.dynamics!.map((group) => group.id)).toEqual(["hairpin-delete"]);
      expect(result!.parts[1]!.measures[0]!.dynamics!.map((group) => group.id)).toEqual(["part-2-hairpin"]);
    });

    it("deletes a standalone cresc. expression from every condensed source", () => {
      const score = makeAnnotatedScore();
      score.parts[0]!.id = "part-1";
      score.parts[0]!.measures[0]!.expressions = [{ text: "cresc.", position: { fraction: [0, 1] } }];
      const secondPart = structuredClone(score.parts[0]!);
      secondPart.id = "part-2";
      score.parts.push(secondPart);
      score.layouts = [
        {
          id: "condensed",
          content: [{ type: "staff", sources: [{ part: "part-1" }, { part: "part-2" }] }],
        },
      ];
      score.scores = [{ name: "Condensed", layout: "condensed" }];
      const selected = [{ kind: "part", type: "expr", measureIndex: 0, partIndex: 0, annotationIndex: 0 }] as const;

      const expanded = expandCondensedDynamicLocations(score, selected, 0);
      const result = deleteAnnotations(score, expanded);

      expect(expanded).toHaveLength(2);
      expect(result!.parts[0]!.measures[0]!.expressions).toBeUndefined();
      expect(result!.parts[1]!.measures[0]!.expressions).toBeUndefined();
    });

    it("deletes a text expression", () => {
      const score = makeAnnotatedScore();
      const result = deleteAnnotation(score, {
        kind: "part",
        type: "expr",
        measureIndex: 0,
        partIndex: 0,
        annotationIndex: 0,
      });
      expect(result).not.toBeNull();
      expect(result!.parts[0]!.measures[0]!.expressions).toBeUndefined();
    });

    it("deletes a chord symbol", () => {
      const score = makeAnnotatedScore();
      const result = deleteAnnotation(score, {
        kind: "part",
        type: "chord",
        measureIndex: 0,
        partIndex: 0,
        annotationIndex: 0,
      });
      expect(result).not.toBeNull();
      expect(result!.parts[0]!.measures[0]!.chordSymbols).toBeUndefined();
    });

    it("deletes a hairpin", () => {
      const score = makeAnnotatedScore();
      const result = deleteAnnotation(score, {
        kind: "part",
        type: "hairpin",
        measureIndex: 0,
        partIndex: 0,
        annotationIndex: 0,
      });
      expect(result).not.toBeNull();
      expect(result!.parts[0]!.measures[0]!.dynamics?.some((group) => group.type === "gradual")).toBe(false);
    });

    it("deletes a pedal", () => {
      const score = makeAnnotatedScore();
      const result = deleteAnnotation(score, {
        kind: "part",
        type: "pedal",
        measureIndex: 0,
        partIndex: 0,
        annotationIndex: 0,
      });
      expect(result).not.toBeNull();
      expect(result!.parts[0]!.measures[0]!.pedals).toBeUndefined();
    });

    it("deletes an ottava", () => {
      const score = makeAnnotatedScore();
      const result = deleteAnnotation(score, {
        kind: "part",
        type: "ottava",
        measureIndex: 0,
        partIndex: 0,
        annotationIndex: 0,
      });
      expect(result).not.toBeNull();
      expect(result!.parts[0]!.measures[0]!.ottavas).toBeUndefined();
    });

    it("returns null for invalid part index", () => {
      const score = makeAnnotatedScore();
      const result = deleteAnnotation(score, {
        kind: "part",
        type: "dyn",
        measureIndex: 0,
        partIndex: 99,
        annotationIndex: 0,
      });
      expect(result).toBeNull();
    });
  });

  it("does not mutate the original score", () => {
    const score = makeAnnotatedScore();
    const originalDynCount = score.parts[0]!.measures[0]!.dynamics!.length;
    deleteAnnotation(score, { kind: "part", type: "dyn", measureIndex: 0, partIndex: 0, annotationIndex: 0 });
    expect(score.parts[0]!.measures[0]!.dynamics).toHaveLength(originalDynCount);
  });
});
