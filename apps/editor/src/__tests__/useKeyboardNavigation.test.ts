import { describe, it, expect } from "vitest";
import type { Score } from "@viritura/core";
import {
  buildNavigationIndex,
  findFirst,
  findLast,
  findNextInVoice,
  findNextMeasure,
  findPrevMeasure,
  findNextSameType,
  findAdjacentVoice,
  getEntry,
} from "../navigation/NavigationIndex";

function makeSimpleScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{}, {}],
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
                    type: "event",
                    id: "e0",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "C", octave: 4 } }],
                  },
                  {
                    type: "event",
                    id: "e1",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "D", octave: 4 } }],
                  },
                ],
              },
            ],
          },
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "e0",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "E", octave: 4 } }],
                  },
                  {
                    type: "event",
                    id: "e1",
                    duration: { base: "quarter" },
                    rest: {},
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

describe("keyboard navigation logic", () => {
  it("element IDs match expected format", () => {
    const score = makeSimpleScore();
    const nav = buildNavigationIndex(score);

    expect(nav.entries[0]!.elementId).toMatch(/^p\d+\/m\d+\/s\d+\//);
    expect(nav.entries).toHaveLength(4);
  });

  it("Right arrow: walks through all events in voice order", () => {
    const score = makeSimpleScore();
    const nav = buildNavigationIndex(score);

    const visited: string[] = [];
    let current = findFirst(nav);
    while (current) {
      visited.push(current);
      current = findNextInVoice(nav, current);
    }

    expect(visited).toHaveLength(4);
    expect(visited[0]).toBe("p0/m0/s0/e0");
    expect(visited[3]).toBe("p0/m1/s0/e1");
  });

  it("Home navigates to first element", () => {
    const score = makeSimpleScore();
    const nav = buildNavigationIndex(score);
    expect(findFirst(nav)).toBe("p0/m0/s0/e0");
  });

  it("End navigates to last element", () => {
    const score = makeSimpleScore();
    const nav = buildNavigationIndex(score);
    expect(findLast(nav)).toBe("p0/m1/s0/e1");
  });

  it("Ctrl+Right navigates to next measure", () => {
    const score = makeSimpleScore();
    const nav = buildNavigationIndex(score);
    expect(findNextMeasure(nav, "p0/m0/s0/e0")).toBe("p0/m1/s0/e0");
  });

  it("Ctrl+Left navigates to previous measure", () => {
    const score = makeSimpleScore();
    const nav = buildNavigationIndex(score);
    expect(findPrevMeasure(nav, "p0/m1/s0/e0")).toBe("p0/m0/s0/e0");
  });

  it("Tab finds next element of same type (note → note, skipping rest)", () => {
    const score = makeSimpleScore();
    const nav = buildNavigationIndex(score);
    // e0 is a note, e1 is a note, e2 (m1/e0) is a note, e3 (m1/e1) is a rest
    expect(findNextSameType(nav, "p0/m0/s0/e0")).toBe("p0/m0/s0/e1");
    // From the last note, Tab should wrap to first note
    expect(findNextSameType(nav, "p0/m1/s0/e0")).toBe("p0/m0/s0/e0");
  });

  it("Up/Down on a rest moves to adjacent voice", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{}] },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      type: "event",
                      id: "e0",
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "C", octave: 5 } }],
                    },
                  ],
                },
                {
                  content: [
                    {
                      type: "event",
                      id: "e0",
                      duration: { base: "quarter" },
                      rest: {},
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const nav = buildNavigationIndex(score);
    const restEntry = getEntry(nav, "p0/m0/s1/e0");
    expect(restEntry?.isRest).toBe(true);
    expect(findAdjacentVoice(nav, "p0/m0/s1/e0", "up")).toBe("p0/m0/s0/e0");
  });

  it("Up/Down on a note targets pitch change (entry is not rest)", () => {
    const score = makeSimpleScore();
    const nav = buildNavigationIndex(score);
    const noteEntry = getEntry(nav, "p0/m0/s0/e0");
    expect(noteEntry?.isRest).toBe(false);
  });
});
