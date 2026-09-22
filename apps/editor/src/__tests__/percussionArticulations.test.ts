import { describe, it, expect } from "vitest";
import type { Score } from "@viritura/core";
import { applyPatchesToScore } from "@viritura/core";
import {
  toggleArticulation,
  planToggleArticulation,
  setSingleTremoloMarks,
  setFermataShape,
  setOrnaments,
} from "../commands/articulationCommands";

// Percussion events carry their noteheads in `kitNotes`, never in `notes`.
// Every guard that decided "can this event hold a marking?" by inspecting
// `notes` alone therefore treated a drum hit as a rest and silently no-opped.

function makeKitScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        name: "Drum Kit",
        id: "p1",
        kit: {
          snare: { sound: "snare", staffPosition: 3, notehead: { glyph: "noteheadBlack" } },
          kick: { sound: "kick", staffPosition: -1, notehead: { glyph: "noteheadBlack" } },
        },
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "k1",
                    duration: { base: "quarter" },
                    kitNotes: [{ kitComponent: "snare" }],
                  },
                  {
                    type: "event",
                    id: "k2",
                    duration: { base: "quarter" },
                    kitNotes: [{ kitComponent: "kick" }],
                  },
                  {
                    type: "event",
                    id: "k3",
                    duration: { base: "half" },
                    rest: {},
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

function eventAt(score: Score, index: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture traversal
  return (score.parts[0]!.measures[0]!.sequences[0]!.content as any[])[index];
}

describe("articulations on percussion (kit) events", () => {
  it("toggles an accent onto a kit-note event", () => {
    const result = toggleArticulation(makeKitScore(), 0, 0, 0, 0, "accent");
    expect(result).not.toBeNull();
    expect(eventAt(result!, 0).markings?.accent).toEqual({});
  });

  it("toggles the accent back off", () => {
    const on = toggleArticulation(makeKitScore(), 0, 0, 0, 0, "accent")!;
    const off = toggleArticulation(on, 0, 0, 0, 0, "accent")!;
    expect(eventAt(off, 0).markings?.accent).toBeUndefined();
  });

  it("applies staccato to a second kit component", () => {
    const result = toggleArticulation(makeKitScore(), 0, 0, 0, 1, "staccato");
    expect(result).not.toBeNull();
    expect(eventAt(result!, 1).markings?.staccato).toEqual({});
  });

  it("still refuses to mark a real rest", () => {
    expect(toggleArticulation(makeKitScore(), 0, 0, 0, 2, "accent")).toBeNull();
  });

  it("leaves the kit notes themselves untouched", () => {
    const result = toggleArticulation(makeKitScore(), 0, 0, 0, 0, "tenuto")!;
    expect(eventAt(result, 0).kitNotes).toEqual([{ kitComponent: "snare" }]);
    expect(eventAt(result, 0).notes).toBeUndefined();
  });

  it("plans an articulation patch for a kit-note event", () => {
    const score = makeKitScore();
    const patches = planToggleArticulation(score, 0, 0, 0, 0, "accent");
    expect(patches).not.toBeNull();
    const next = applyPatchesToScore(score, patches!);
    expect(eventAt(next, 0).markings?.accent).toEqual({});
  });

  it("plans nothing for a rest", () => {
    expect(planToggleArticulation(makeKitScore(), 0, 0, 0, 2, "accent")).toBeNull();
  });

  it("accepts tremolo, fermata and ornaments on kit events", () => {
    expect(setSingleTremoloMarks(makeKitScore(), 0, 0, 0, 0, 3)).not.toBeNull();
    expect(setFermataShape(makeKitScore(), 0, 0, 0, 0, "normal")).not.toBeNull();
    expect(setOrnaments(makeKitScore(), 0, 0, 0, 0, ["trill"])).not.toBeNull();
  });
});
