import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";
import { hiddenRestPlaceholderId, restMetadataLosses, setRestHiddenInScore } from "../score/hiddenRestMutations";
import { resolveEventLocation } from "../score/ElementPath";

const target = { partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 0 };

function scoreWith(content: Score["parts"][number]["measures"][number]["sequences"][number]["content"]): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{}] },
    parts: [{ name: "Part", measures: [{ sequences: [{ content }] }] }],
  };
}

describe("hidden rest mutations", () => {
  it("uses a standard space and restores the same dotted duration after reopening", () => {
    const original = scoreWith([{ type: "event", duration: { base: "quarter", dots: 1 }, rest: {} }]);
    const hidden = setRestHiddenInScore(original, target, true);

    expect(hidden.parts[0]!.measures[0]!.sequences[0]!.content[0]).toEqual({
      type: "space",
      duration: [3, 8],
    });
    const serialized = serializeMnx(hidden) as {
      parts: { measures: { sequences: { content: unknown[] }[] }[] }[];
    };
    expect(serialized.parts[0]!.measures[0]!.sequences[0]!.content[0]).toEqual({
      type: "space",
      duration: [3, 8],
    });

    const reopened = parseMnx(serialized);
    const visible = setRestHiddenInScore(reopened, target, false);
    expect(visible.parts[0]!.measures[0]!.sequences[0]!.content[0]).toEqual({
      type: "event",
      duration: { base: "quarter", dots: 1 },
      rest: {},
    });
  });

  it("reports every rest-only field before conversion", () => {
    const rest = {
      type: "event" as const,
      id: "rest-1",
      duration: { base: "quarter" as const },
      rest: { staffPosition: 2 },
      staff: 2,
      fermata: { symbol: "normal" as const },
    };
    expect(restMetadataLosses(rest)).toEqual(["identifier", "staff position", "staff assignment", "fermata"]);
  });

  it("resolves the synthetic selectable placeholder to its source space", () => {
    const hidden = scoreWith([{ type: "space", duration: [1, 4] }]);
    expect(resolveEventLocation(hiddenRestPlaceholderId(target), hidden)).toEqual(target);
  });

  it("does not invent a rest spelling for an unsupported space duration", () => {
    const hidden = scoreWith([{ type: "space", duration: [1, 3] }]);
    expect(setRestHiddenInScore(hidden, target, false)).toBe(hidden);
  });
});
