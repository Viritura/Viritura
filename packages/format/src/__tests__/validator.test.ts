import { describe, expect, it } from "vitest";
import { validateRawScore } from "../mnx/validator";

function percussionScore() {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ id: "m1" }],
      sounds: { "snd-snare": { midiNumber: 38 } },
    },
    parts: [
      {
        kit: { snare: { staffPosition: 0, sound: "snd-snare" } },
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    duration: { base: "quarter" },
                    kitNotes: [{ kitComponent: "snare" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function betweenDynamicScore(staff: number) {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m1" }] },
    parts: [
      {
        staves: 2,
        measures: [
          {
            dynamics: [
              {
                type: "immediate",
                position: { fraction: [0, 1] },
                value: "p",
                staff,
                orient: "between",
              },
            ],
            sequences: [],
          },
        ],
      },
    ],
  };
}

describe("MNX percussion semantic validation", () => {
  it("accepts valid component and sound references", () => {
    expect(validateRawScore(percussionScore()).ok).toBe(true);
  });

  describe("Viritura extension validation", () => {
    it("validates a part-ID-keyed sound assignment and rejects malformed source choices", () => {
      const score = percussionScore() as ReturnType<typeof percussionScore> & {
        _x?: { viritura?: Record<string, unknown> };
      };
      score.parts[0]!.id = "snare-1";
      score._x = {
        viritura: {
          soundProfile: {
            profileId: "viritura-sounds",
            profileVersion: 1,
            parts: { "snare-1": { sourceId: "tuba-primary" } },
          },
        },
      };
      expect(validateRawScore(score).ok).toBe(true);

      score._x.viritura!.soundProfile = {
        profileId: "viritura-sounds",
        profileVersion: 1,
        parts: { 0: { midiProgram: 58 } },
      };
      const invalid = validateRawScore(score);
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) {
        expect(invalid.errors).toContainEqual(
          expect.objectContaining({ pointer: expect.stringContaining("/_x/viritura"), keyword: "required" }),
        );
      }
    });

    it("rejects unknown fields in nested extension payloads", () => {
      const score = percussionScore();
      const event = score.parts[0]!.measures[0]!.sequences[0]!.content[0]! as Record<string, unknown>;
      event["_x"] = { viritura: { inventedProperty: true } };

      const result = validateRawScore(score);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            pointer: "/parts/0/measures/0/sequences/0/content/0/_x/viritura",
            keyword: "additionalProperties",
          }),
        );
      }
    });

    it("rejects Viritura payloads at unsupported MNX object locations", () => {
      const score = percussionScore();
      const sequence = score.parts[0]!.measures[0]!.sequences[0]! as Record<string, unknown>;
      sequence["_x"] = { viritura: { inventedProperty: true } };

      const result = validateRawScore(score);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            pointer: "/parts/0/measures/0/sequences/0/_x/viritura",
            keyword: "extensionLocation",
          }),
        );
      }
    });

    it("accepts the generated staff-line range restoration marker", () => {
      const score = percussionScore();
      const measure = score.parts[0]!.measures[0]! as Record<string, unknown>;
      measure["staffConfigs"] = [
        {
          config: { lines: 5 },
          _x: { viritura: { staffLineRangeRestore: true } },
        },
      ];

      expect(validateRawScore(score).ok).toBe(true);
    });

    it("rejects a non-object Viritura payload", () => {
      const score = percussionScore() as ReturnType<typeof percussionScore> & { _x?: unknown };
      score._x = { viritura: "not-an-object" };
      expect(validateRawScore(score).ok).toBe(false);
    });
  });

  it("rejects nonstandard core properties and enum values", () => {
    const unknownProperty = percussionScore() as ReturnType<typeof percussionScore> & {
      global: { measures: Array<Record<string, unknown>> };
    };
    unknownProperty.global.measures[0]!["inventedProperty"] = true;
    expect(validateRawScore(unknownProperty).ok).toBe(false);

    const nonstandardEnum = percussionScore() as ReturnType<typeof percussionScore> & {
      global: { measures: Array<Record<string, unknown>> };
    };
    nonstandardEnum.global.measures[0]!["time"] = { count: 4, unit: 4, display: "senzaMisura" };
    const result = validateRawScore(nonstandardEnum);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContainEqual(expect.objectContaining({ keyword: "enum" }));
  });

  it("rejects a kit component whose sound does not exist", () => {
    const score = percussionScore();
    score.parts[0]!.kit.snare.sound = "missing";
    const result = validateRawScore(score);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContainEqual(expect.objectContaining({ keyword: "reference" }));
  });

  it("rejects a kit note whose component does not exist", () => {
    const score = percussionScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content[0]!.kitNotes[0]!.kitComponent = "missing";
    const result = validateRawScore(score);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ pointer: expect.stringContaining("/kitComponent"), keyword: "reference" }),
      );
    }
  });
});

describe("MNX dynamic semantic validation", () => {
  it("accepts a between dynamic associated with the last staff", () => {
    expect(validateRawScore(betweenDynamicScore(2)).ok).toBe(true);
  });

  it("still rejects a dynamic associated with a nonexistent staff", () => {
    const result = validateRawScore(betweenDynamicScore(3));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          pointer: "/parts/0/measures/0/dynamics/0/staff",
          keyword: "range",
        }),
      );
    }
  });
});
