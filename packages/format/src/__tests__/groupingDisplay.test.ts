import { describe, expect, it } from "vitest";
import { parseMnx } from "../mnx/parser";
import { serializeMnx } from "../mnx/serializer";
import { validateRawScore } from "../mnx/validator";

function scoreWithGroupingDisplay(options: {
  groupingDisplay?: unknown;
  beatStructure?: unknown;
  groupingDisplayOverrides?: unknown;
  nonDefaultGroupingDisplay?: unknown;
}) {
  const timeExt: Record<string, unknown> = {};
  if (options.beatStructure !== undefined) timeExt["beatStructure"] = options.beatStructure;
  if (options.groupingDisplay !== undefined) timeExt["groupingDisplay"] = options.groupingDisplay;

  const partMeasureExt: Record<string, unknown> = {};
  if (options.groupingDisplayOverrides !== undefined) {
    partMeasureExt["groupingDisplayOverrides"] = options.groupingDisplayOverrides;
  }

  const root: Record<string, unknown> = {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          time: {
            count: 7,
            unit: 8,
            ...(Object.keys(timeExt).length > 0 ? { _x: { viritura: timeExt } } : {}),
          },
        },
      ],
    },
    parts: [
      {
        measures: [
          {
            sequences: [{ content: [] }],
            ...(Object.keys(partMeasureExt).length > 0 ? { _x: { viritura: partMeasureExt } } : {}),
          },
        ],
      },
    ],
  };
  if (options.nonDefaultGroupingDisplay !== undefined) {
    root["_x"] = {
      viritura: {
        timeSignatures: { score: { nonDefaultGroupingDisplay: options.nonDefaultGroupingDisplay } },
      },
    };
  }
  return root;
}

describe("time-signature groupingDisplay occurrence extension", () => {
  it("round-trips an explicit per-occurrence override", () => {
    const source = scoreWithGroupingDisplay({ beatStructure: [3, 2, 2], groupingDisplay: "annotation" });
    const parsed = parseMnx(source);

    expect(parsed.global.measures[0]!.time?.groupingDisplay).toBe("annotation");
    expect(serializeMnx(parsed)).toMatchObject(source);
  });

  it("rejects an unknown groupingDisplay value", () => {
    const result = validateRawScore(scoreWithGroupingDisplay({ groupingDisplay: "spread-out" }));
    expect(result.ok).toBe(false);
  });

  it("omits groupingDisplay from serialization when absent", () => {
    const source = scoreWithGroupingDisplay({ beatStructure: [3, 2, 2] });
    const parsed = parseMnx(source);
    expect(parsed.global.measures[0]!.time?.groupingDisplay).toBeUndefined();
    const out = serializeMnx(parsed) as { global: { measures: Array<{ time?: { _x?: unknown } }> } };
    const ext = out.global.measures[0]!.time?._x as { viritura?: { groupingDisplay?: unknown } } | undefined;
    expect(ext?.viritura?.groupingDisplay).toBeUndefined();
  });
});

describe("part-measure groupingDisplayOverrides extension", () => {
  it("round-trips a per-staff occurrence override", () => {
    const source = scoreWithGroupingDisplay({
      groupingDisplayOverrides: [{ staff: 1, groupingDisplay: "standard" }],
    });
    const parsed = parseMnx(source);

    expect(parsed.parts[0]!.measures[0]!.groupingDisplayOverrides).toEqual([{ staff: 1, groupingDisplay: "standard" }]);
    expect(serializeMnx(parsed)).toMatchObject(source);
  });

  it("rejects a staff-grouping-display-override missing a required field", () => {
    const result = validateRawScore(scoreWithGroupingDisplay({ groupingDisplayOverrides: [{ staff: 1 }] }));
    expect(result.ok).toBe(false);
  });

  it("rejects a non-positive staff number", () => {
    const result = validateRawScore(
      scoreWithGroupingDisplay({ groupingDisplayOverrides: [{ staff: 0, groupingDisplay: "additive" }] }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("house-style nonDefaultGroupingDisplay extension", () => {
  it("round-trips the house-style setting", () => {
    const source = scoreWithGroupingDisplay({ nonDefaultGroupingDisplay: "additive" });
    const parsed = parseMnx(source);

    expect(parsed.timeSignatures?.score?.nonDefaultGroupingDisplay).toBe("additive");
    const out = serializeMnx(parsed) as {
      _x?: { viritura?: { timeSignatures?: { score?: { nonDefaultGroupingDisplay?: unknown } } } };
    };
    expect(out._x?.viritura?.timeSignatures?.score?.nonDefaultGroupingDisplay).toBe("additive");
  });

  it("defaults to standard (omitted) when not specified", () => {
    const source = scoreWithGroupingDisplay({});
    const parsed = parseMnx(source);
    expect(parsed.timeSignatures?.score?.nonDefaultGroupingDisplay).toBeUndefined();
  });
});
