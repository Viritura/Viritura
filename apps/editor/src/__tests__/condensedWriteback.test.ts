import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import {
  applySelectionWriteback,
  expandCondensedSpannerIds,
  expandCondensedSubElementIds,
  resolveCondensedSelectionEvents,
  planCondensedEventWriteback,
  planCondensedSelectionWriteback,
} from "../score/condensedWriteback";
import { applyArticulationToSelection } from "../radialMenu/applyToSelection";
import { handleDelete } from "../keyboard/normalModeDelete";
import type { KeyboardHandlerContext } from "../keyboard/types";
import type { Selection } from "../store/selectionStore";

function condensedScore(sourceCount: number, divisi = false): Score {
  const parts = Array.from({ length: sourceCount }, (_, index) => ({
    id: `part-${index}`,
    name: `Player ${index + 1}`,
    measures: [
      {
        sequences: [
          {
            content: divisi
              ? Array.from({ length: index + 1 }, (__, eventIndex) => ({
                  type: "event" as const,
                  id: `event-${index}-${eventIndex}`,
                  duration: { base: "quarter" as const },
                  notes: [{ pitch: { step: "C" as const, octave: 4 as const } }],
                }))
              : [
                  {
                    type: "event" as const,
                    id: `event-${index}`,
                    duration: { base: "whole" as const },
                    notes: [{ pitch: { step: "C" as const, octave: 4 as const } }],
                  },
                ],
          },
        ],
      },
    ],
  }));
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts,
    layouts: [
      {
        id: "condensed",
        content: [
          {
            type: "staff",
            sources: parts.map((part) => ({ part: part.id })),
          },
        ],
      },
    ],
    scores: [{ name: "Condensed", layout: "condensed" }],
  };
}

function deleteSelection(score: Score, selection: Selection): Score {
  let current = score;
  const context = {
    getScore: () => current,
    getSelection: () => selection,
    getConfig: () => ({ selectedScoreIndex: 0 }),
    updateScore: (next: Score) => {
      current = next;
    },
    clearSelection: () => {},
  } as unknown as KeyboardHandlerContext;
  handleDelete({ preventDefault() {} } as KeyboardEvent, false, context);
  return current;
}

describe("condensed projection write-back", () => {
  it("describes merged projection edits as broadcast source write-back", () => {
    const score = condensedScore(3);
    const selection = { kind: "single", elementId: "p0/m0/s0/event-0", elementType: "event" } as const;

    const plan = planCondensedSelectionWriteback(score, selection, 0);

    expect(plan.events).toHaveLength(1);
    expect(plan.events[0]?.strategy).toBe("broadcast");
    expect(plan.events[0]?.visualEvent.partIndex).toBe(0);
    expect(plan.sourceEvents.map((event) => event.partIndex)).toEqual([0, 1, 2]);
  });

  it("writes a condensed edit to canonical sources and derives the next plan from them", () => {
    const score = condensedScore(2);
    const selection = { kind: "single", elementId: "p0/m0/s0/event-0", elementType: "event" } as const;
    const updated = applySelectionWriteback(
      score,
      selection,
      (draft, location) => {
        const event = draft.parts[location.partIndex]!.measures[0]!.sequences[0]!.content[0]!;
        if (event.type === "event") event.markings = { staccato: {} };
      },
      0,
    )!;

    expect(updated).not.toBe(score);
    expect(
      updated.parts.every((part) => {
        const event = part.measures[0]!.sequences[0]!.content[0]!;
        return event.type === "event" && event.markings?.staccato !== undefined;
      }),
    ).toBe(true);
    expect(
      planCondensedEventWriteback(updated, 0, {
        partIndex: 0,
        measureIndex: 0,
        sequenceIndex: 0,
        eventIndex: 0,
      }).strategy,
    ).toBe("broadcast");
  });

  it("derives source-specific write-back after an individual edit makes the projection divisi", () => {
    const score = condensedScore(2);
    score.parts[1]!.measures[0]!.sequences[0]!.content = [
      {
        type: "event",
        id: "event-1-a",
        duration: { base: "half" },
        notes: [{ pitch: { step: "C", octave: 4 } }],
      },
      {
        type: "event",
        id: "event-1-b",
        duration: { base: "half" },
        notes: [{ pitch: { step: "D", octave: 4 } }],
      },
    ];

    const plan = planCondensedEventWriteback(score, 0, {
      partIndex: 1,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
    });

    expect(plan.strategy).toBe("direct");
    expect(plan.sourceEvents.map((event) => event.partIndex)).toEqual([1]);
  });

  it.each([2, 3, 4])("broadcasts merged notation to all %i source parts", (sourceCount) => {
    const score = condensedScore(sourceCount);
    const events = resolveCondensedSelectionEvents(
      score,
      { kind: "single", elementId: "p0/m0/s0/event-0", elementType: "event" },
      0,
    );

    expect(events.map((event) => event.partIndex)).toEqual(Array.from({ length: sourceCount }, (_, index) => index));
  });

  it("keeps divisi notation source-specific", () => {
    const score = condensedScore(3, true);
    const events = resolveCondensedSelectionEvents(
      score,
      { kind: "single", elementId: "p1/m0/s0/event-1-0", elementType: "event" },
      0,
    );

    expect(events.map((event) => event.partIndex)).toEqual([1]);
  });

  it("expands articulation IDs to every merged source event", () => {
    const score = condensedScore(4);
    const ids = expandCondensedSubElementIds(score, ["p0/m0/s0/event-0/art-staccato"], 0);

    expect(ids).toEqual([
      "p0/m0/s0/event-0/art-staccato",
      "p1/m0/s0/event-1/art-staccato",
      "p2/m0/s0/event-2/art-staccato",
      "p3/m0/s0/event-3/art-staccato",
    ]);
  });

  it("keeps one notehead in an amalgamated chord linked to its source", () => {
    const score = condensedScore(2);
    const secondEvent = score.parts[1]!.measures[0]!.sequences[0]!.content[0]!;
    if (secondEvent.type === "event") secondEvent.notes![0]!.pitch.step = "E";

    expect(expandCondensedSubElementIds(score, ["p1/m0/s0/event-1/n0"], 0)).toEqual(["p1/m0/s0/event-1/n0"]);
  });

  it("keeps a unison notehead linked to every source contributor", () => {
    const score = condensedScore(2);

    expect(expandCondensedSubElementIds(score, ["p0/m0/s0/event-0/n0"], 0)).toEqual([
      "p0/m0/s0/event-0/n0",
      "p1/m0/s0/event-1/n0",
    ]);
  });

  it("writes an expanded source-staff selection only to that source", () => {
    const score = condensedScore(2);
    const selection = {
      kind: "single",
      elementId: "p1/m0/s0/event-1",
      elementType: "event",
      measureAnchor: {
        partIndex: 1,
        staffIndex: 2,
        measureIndex: 0,
        isExpansion: true,
      },
    } as const;

    const plan = planCondensedSelectionWriteback(score, selection, 0);

    expect(plan.events[0]?.strategy).toBe("direct");
    expect(plan.sourceEvents.map((event) => event.partIndex)).toEqual([1]);
  });

  it("deletes only the selected source note from an amalgamated chord", () => {
    const score = condensedScore(2);
    const secondEvent = score.parts[1]!.measures[0]!.sequences[0]!.content[0]!;
    if (secondEvent.type === "event") secondEvent.notes![0]!.pitch.step = "E";

    const updated = deleteSelection(score, {
      kind: "single",
      elementId: "p1/m0/s0/event-1/n0",
      elementType: "note",
    });

    const first = updated.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    expect(first.type === "event" && first.notes).toHaveLength(1);
    expect(updated.parts[1]!.measures[0]!.sequences[0]).toEqual({
      content: [],
      fullMeasure: { visualDuration: { base: "whole" } },
    });
  });

  it("deletes a note from an expanded source staff without changing its peer", () => {
    const score = condensedScore(2);

    const updated = deleteSelection(score, {
      kind: "single",
      elementId: "p1/m0/s0/event-1/n0",
      elementType: "note",
      measureAnchor: {
        partIndex: 1,
        staffIndex: 2,
        measureIndex: 0,
        isExpansion: true,
      },
    });

    const first = updated.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    expect(first.type === "event" && first.notes).toHaveLength(1);
    expect(updated.parts[1]!.measures[0]!.sequences[0]).toEqual({
      content: [],
      fullMeasure: { visualDuration: { base: "whole" } },
    });
  });

  it("applies and removes an articulation uniformly across four merged sources", () => {
    const score = condensedScore(4);
    const selection = { kind: "single", elementId: "p0/m0/s0/event-0", elementType: "event" } as const;
    const applied = applyArticulationToSelection(score, selection, "staccato", 0)!;
    for (const part of applied.parts) {
      const event = part.measures[0]!.sequences[0]!.content[0];
      expect(event?.type === "event" && event.markings?.staccato).toBeDefined();
    }

    const removed = applyArticulationToSelection(applied, selection, "staccato", 0)!;
    for (const part of removed.parts) {
      const event = part.measures[0]!.sequences[0]!.content[0];
      expect(event?.type === "event" && event.markings?.staccato).toBeUndefined();
    }
  });

  it("expands slur and tie IDs across three merged sources", () => {
    const score = condensedScore(3);
    for (let partIndex = 0; partIndex < score.parts.length; partIndex++) {
      score.parts[partIndex]!.measures[0]!.sequences[0]!.content = [
        {
          type: "event",
          id: `source-${partIndex}`,
          duration: { base: "half" },
          notes: [{ id: `note-${partIndex}-a`, pitch: { step: "C", octave: 4 } }],
        },
        {
          type: "event",
          id: `target-${partIndex}`,
          duration: { base: "half" },
          notes: [{ id: `note-${partIndex}-b`, pitch: { step: "D", octave: 4 } }],
        },
      ];
    }

    expect(expandCondensedSpannerIds(score, "slur/source-0/target-0", 0)).toEqual([
      "slur/source-0/target-0",
      "slur/source-1/target-1",
      "slur/source-2/target-2",
    ]);
    expect(expandCondensedSpannerIds(score, "tie/note-0-a/note-0-b", 0)).toEqual([
      "tie/note-0-a/note-0-b",
      "tie/note-1-a/note-1-b",
      "tie/note-2-a/note-2-b",
    ]);
  });
});
