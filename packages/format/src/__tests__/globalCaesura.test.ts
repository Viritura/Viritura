import { describe, expect, it } from "vitest";
import { applyPatchesToScore, patch } from "@viritura/core";
import { parseMnx } from "../mnx/parser";
import { serializeMnx } from "../mnx/serializer";
import { DeltaSerializer } from "../mnx/deltaSerializer";

function document(caesura: object) {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          time: { count: 4, unit: 4 },
          caesura,
          segno: { location: { fraction: [0, 1] } },
          _x: { viritura: { markerText: { segno: { content: [{ text: "Keep this" }], placement: "before" } } } },
        },
      ],
    },
    parts: [
      {
        id: "piano",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    duration: { base: "whole" },
                    notes: [{ pitch: { step: "C", octave: 4 } }],
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

describe("native global caesuras", () => {
  it("validates global stroke counts against the native v46 schema", () => {
    expect(() => parseMnx(document({ marks: 3 }))).toThrow("/global/measures/0/caesura/marks: must be <= 2");
  });

  it.each(["normal", "thick", "short", "curved"] as const)(
    "retains %s shapes, strokes and native attributes",
    (shape) => {
      for (const marks of [1, 2] as const) {
        const native = { shape, marks, id: "pause", _c: "pause-class", _x: { test: { retained: true } } };
        const score = parseMnx(document(native));
        expect(score.global.measures[0]!.caesura).toEqual({
          style: shape,
          marks,
          id: "pause",
          _c: "pause-class",
          _x: { test: { retained: true } },
        });
        const wire = serializeMnx(score);
        expect(wire).toMatchObject({ global: { measures: [{ caesura: native }] } });
        expect(parseMnx(wire).global.measures[0]!.segno?.text).toEqual({
          content: [{ text: "Keep this" }],
          placement: "before",
        });
      }
    },
  );

  it("retains an empty default and updates/removes it through delta serialization", () => {
    const score = parseMnx(document({}));
    expect(score.global.measures[0]!.caesura).toEqual({});
    const delta = new DeltaSerializer();
    expect(JSON.parse(delta.serialize(score).json)).toEqual(serializeMnx(score));
    const edited = applyPatchesToScore(score, [
      patch.setGlobalMeasureField(0, { field: "caesura", value: { style: "curved", marks: 1 } }),
    ]);
    const changed = delta.serialize(edited);
    expect(changed.changedGlobalMeasures).toEqual([0]);
    expect(JSON.parse(changed.json)).toEqual(serializeMnx(edited));
    const removed = applyPatchesToScore(edited, [
      patch.setGlobalMeasureField(0, { field: "caesura", value: undefined }),
    ]);
    expect(JSON.parse(delta.serialize(removed).json)).toEqual(serializeMnx(removed));
    expect(parseMnx(serializeMnx(removed)).global.measures[0]!.caesura).toBeUndefined();
  });
});
