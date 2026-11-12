import { describe, it, expect } from "vitest";
import type { Note, Score } from "@viritura/core";
import { generateTimeline } from "../timeline";
import { generatePerformanceEvents } from "../performanceEvents";

function scoreWithEvents(events: Note[][]): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        id: "p1",
        measures: [
          {
            sequences: [
              {
                content: events.map((notes) => ({ type: "event", duration: { base: "quarter" }, notes })),
              },
            ],
          },
        ],
      } as never,
    ],
  };
}

const C4: Note = { pitch: { step: "C", octave: 4 } };
const E4: Note = { pitch: { step: "E", octave: 4 } };

describe("unpitched noteheads on pitched staves", () => {
  it.each(["x", "circleX", "slash"] as const)("does not sound a %s notehead", (notehead) => {
    const score = scoreWithEvents([[{ ...C4, notehead }], [E4]]);
    const noteOns = generateTimeline(score).events.filter((e) => e.type === "noteOn");
    expect(noteOns.map((e) => e.midiNote)).toEqual([64]);
    const performed = generatePerformanceEvents(score, 0).filter((e) => e.kind === "noteOn");
    expect(performed).toHaveLength(1);
  });

  it("keeps pitched noteheads and normal chord members sounding", () => {
    const score = scoreWithEvents([
      [{ ...C4, notehead: "x" }, E4],
      [{ ...C4, notehead: "diamond" }],
      [{ ...C4, notehead: "triangleUp" }],
    ]);
    const noteOns = generateTimeline(score).events.filter((e) => e.type === "noteOn");
    expect(noteOns.map((e) => e.midiNote)).toEqual([64, 60, 60]);
  });
});
