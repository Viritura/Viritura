import { describe, expect, it } from "vitest";
import type { JsonRecord } from "./types";
import { TargetIndex, eventId } from "./targetIndex";

function documentWithContent(content: JsonRecord[]): JsonRecord {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m1", time: { count: 4, unit: 4 } }] },
    parts: [{ id: "P1", measures: [{ sequences: [{ content }] }] }],
  };
}

function event(id: string, duration = "quarter"): JsonRecord {
  return {
    id,
    duration: { base: duration },
    notes: [{ id: `${id}n1`, pitch: { step: "C", octave: 4 } }],
  };
}

describe("TargetIndex rhythmic positions", () => {
  it("advances past MNX spaces without indexing them as events", () => {
    const index = new TargetIndex(documentWithContent([{ type: "space", duration: [1, 4] }, event("after-space")]));

    const target = index.event({
      anchor: "P1.m1",
      position: { numerator: 1, denominator: 4 },
    });

    expect(target?.edge).toBe("start");
    expect(target && eventId(target.event)).toBe("after-space");
  });

  it("indexes grace notes without advancing the principal event position", () => {
    const index = new TargetIndex(
      documentWithContent([{ type: "grace", content: [event("grace", "eighth")] }, event("principal")]),
    );

    const target = index.event({
      anchor: "P1.m1",
      position: { numerator: 0, denominator: 1 },
    });

    expect(target?.edge).toBe("start");
    expect(target && eventId(target.event)).toBe("principal");
    expect(eventId(index.event({ anchor: "grace" })!.event)).toBe("grace");
  });
});
