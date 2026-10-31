import { describe, expect, it } from "vitest";
import { ParseError } from "../errors";
import { layoutArgs, mnxJson } from "../layoutRequest";

const score = {
  mnx: { version: 1 },
  global: { measures: [{ time: { count: 4, unit: 4 } }] },
  parts: [
    {
      measures: [
        {
          sequences: [
            {
              content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }],
            },
          ],
        },
      ],
    },
  ],
};

describe("public layout input boundary", () => {
  it("validates object and string inputs without assigning IDs or rewriting JSON", () => {
    const json = JSON.stringify(score, null, 2);
    expect(mnxJson(json)).toBe(json);
    expect(mnxJson(score)).toBe(JSON.stringify(score));
    expect(layoutArgs(json, { pageWidth: 800 }).json).toBe(json);
    expect(score.parts[0]!.measures[0]!.sequences[0]!.content[0]).not.toHaveProperty("id");
  });

  it("accepts native v46 markers", () => {
    const native = {
      ...score,
      global: {
        measures: [
          {
            coda: { location: { fraction: [0, 1] }, glyph: "codaSquare" },
            jump: { type: "dcAlCoda", location: { fraction: [1, 1] } },
          },
        ],
      },
    };
    expect(mnxJson(native)).toBe(JSON.stringify(native));
  });

  it("reports malformed JSON and non-serializable objects as JSON errors", () => {
    expect(() => mnxJson("{")).toThrow(expect.objectContaining({ name: "ParseError", code: "json" }));
    expect(() => mnxJson({ value: 1n })).toThrow(expect.objectContaining({ name: "ParseError", code: "json" }));
  });

  it("rejects obsolete jump spellings before the lenient native model builder can discard them", () => {
    const obsolete = {
      ...score,
      global: { measures: [{ jump: { type: "dsalfine", location: { fraction: [0, 1] } } }] },
    };
    expect(() => mnxJson(obsolete)).toThrow(ParseError);
    expect(() => mnxJson(obsolete)).toThrow(expect.objectContaining({ code: "schema" }));
  });

  it("rejects invalid dynamic variants and microtonal alterations at the same boundary", () => {
    const invalidDynamic = {
      ...score,
      parts: [
        {
          measures: [
            {
              sequences: score.parts[0]!.measures[0]!.sequences,
              dynamics: [{ type: "immediate", position: { fraction: [0, 1] }, value: "f", relativeValue: "louder" }],
            },
          ],
        },
      ],
    };
    expect(() => mnxJson(invalidDynamic)).toThrow(expect.objectContaining({ code: "schema" }));
    const invalidPitch = {
      ...score,
      parts: [
        {
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      duration: { base: "whole" },
                      notes: [{ pitch: { step: "C", octave: 4, alter: 0.5 } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(() => mnxJson(invalidPitch)).toThrow(expect.objectContaining({ code: "schema" }));
  });
});
