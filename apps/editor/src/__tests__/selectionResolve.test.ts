import { describe, it, expect } from "vitest";
import type { Score, NoteEvent, Step, Octave } from "@viritura/core";
import {
  resolveSelectionEvents,
  resolveSelectionScope,
  resolveSelectionAnchor,
  resolveSelection,
} from "../store/selectionUtils";
import {
  EVENT_ACTION,
  SCOPE_ACTION,
  ANCHOR_ACTION,
  SELECTION_CAPABILITIES,
  selectionSupports,
  resolveCapabilityTargets,
} from "../store/selectionCapabilities";
import type { Selection } from "../store/selectionStore";

// ═══════════════════════════════════════════
// Test helpers
// ═══════════════════════════════════════════

function note(id: string, step: Step = "C", octave: Octave = 4): NoteEvent {
  return { type: "event", id, duration: { base: "quarter" }, notes: [{ pitch: { step, octave } }] };
}

function chord(id: string): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base: "quarter" },
    notes: [
      { pitch: { step: "C", octave: 4 } },
      { pitch: { step: "E", octave: 4 } },
      { pitch: { step: "G", octave: 4 } },
    ],
  };
}

/**
 * 2 parts × 2 measures.
 * Part 0 / measure 0 / seq 0: [ev0 (chord), ev1].
 * Part 0 / measure 1 / seq 0: [tuplet(ev2, ev3)].
 * Part 1 / measure 0 / seq 0: [c0]; measure 1: [c1].
 */
function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m0", time: { count: 4, unit: 4 } }, { id: "m1" }] },
    parts: [
      {
        name: "Violin",
        measures: [
          { sequences: [{ content: [chord("ev0"), note("ev1", "D")] }] },
          {
            sequences: [
              {
                content: [
                  {
                    type: "tuplet",
                    outer: { duration: { base: "quarter" }, multiple: 1 },
                    inner: { duration: { base: "eighth" }, multiple: 3 },
                    content: [note("ev2", "E"), note("ev3", "F")],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        name: "Cello",
        measures: [
          { sequences: [{ content: [note("c0", "C", 3)] }] },
          { sequences: [{ content: [note("c1", "D", 3)] }] },
        ],
      },
    ],
  };
}

// ═══════════════════════════════════════════
// resolveSelectionEvents
// ═══════════════════════════════════════════

describe("resolveSelectionEvents", () => {
  it("returns [] for none", () => {
    expect(resolveSelectionEvents({ kind: "none" }, makeScore())).toEqual([]);
  });

  it("resolves a single event", () => {
    const sel: Selection = { kind: "single", elementId: "p0/m0/s0/ev0", elementType: "event" };
    const events = resolveSelectionEvents(sel, makeScore());
    expect(events).toEqual([{ partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 0 }]);
  });

  it("resolves a notehead sub-element to its parent event (noteIndex dropped)", () => {
    const sel: Selection = { kind: "single", elementId: "p0/m0/s0/ev0/n2", elementType: "note" };
    const events = resolveSelectionEvents(sel, makeScore());
    expect(events).toEqual([{ partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 0 }]);
  });

  it("de-duplicates two noteheads of the same chord into one event", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/ev0/n0", "p0/m0/s0/ev0/n2"] };
    const events = resolveSelectionEvents(sel, makeScore());
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 0 });
  });

  it("resolves multi to distinct events in document order regardless of input order", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/ev1", "p0/m0/s0/ev0"] };
    const events = resolveSelectionEvents(sel, makeScore());
    expect(events.map((e) => e.eventIndex)).toEqual([0, 1]);
  });

  it("resolves tuplet-nested events with tupletIndex", () => {
    const sel: Selection = { kind: "single", elementId: "p0/m1/s0/ev2", elementType: "event" };
    const events = resolveSelectionEvents(sel, makeScore());
    expect(events).toEqual([{ partIndex: 0, measureIndex: 1, sequenceIndex: 0, eventIndex: 0, tupletIndex: 0 }]);
  });

  it("orders tuplet events between their surrounding top-level events", () => {
    const score = makeScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      note("before"),
      {
        type: "tuplet",
        outer: { duration: { base: "quarter" }, multiple: 1 },
        inner: { duration: { base: "eighth" }, multiple: 3 },
        content: [note("inner-0"), note("inner-1")],
      },
      note("after"),
    ];
    const sel: Selection = {
      kind: "multi",
      elementIds: ["p0/m0/s0/after", "p0/m0/s0/inner-1", "p0/m0/s0/before", "p0/m0/s0/inner-0"],
    };

    expect(resolveSelectionEvents(sel, score)).toEqual([
      { partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 0 },
      { partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 0, tupletIndex: 1 },
      { partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 1, tupletIndex: 1 },
      { partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 2 },
    ]);
  });

  it("resolves a measure rectangle to every covered event across staves and tuplets", () => {
    const sel: Selection = {
      kind: "measure",
      startPartIndex: 0,
      endPartIndex: 1,
      startStaffIndex: 0,
      endStaffIndex: 0,
      startMeasure: 0,
      endMeasure: 1,
    };
    const events = resolveSelectionEvents(sel, makeScore());
    // p0/m0: ev0, ev1; p0/m1: ev2, ev3 (in tuplet); p1/m0: c0; p1/m1: c1
    expect(events).toHaveLength(6);
    // Document order: part 0 first.
    expect(events.slice(0, 2)).toEqual([
      { partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 0 },
      { partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 1 },
    ]);
    expect(events[2]).toEqual({ partIndex: 0, measureIndex: 1, sequenceIndex: 0, eventIndex: 0, tupletIndex: 0 });
  });

  it("includes tremolo-container events in a measure selection (regression: tremolo was skipped)", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ id: "m0", time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Violin",
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      type: "tremolo",
                      marks: 3,
                      outer: { duration: { base: "quarter" }, multiple: 1 },
                      content: [note("tr0", "C"), note("tr1", "E")],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const sel: Selection = {
      kind: "measure",
      startPartIndex: 0,
      endPartIndex: 0,
      startStaffIndex: 0,
      endStaffIndex: 0,
      startMeasure: 0,
      endMeasure: 0,
    };
    const events = resolveSelectionEvents(sel, score);
    expect(events).toEqual([
      { partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 0, tupletIndex: 0 },
      { partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 1, tupletIndex: 0 },
    ]);
  });
});

// ═══════════════════════════════════════════
// resolveSelectionScope / anchor
// ═══════════════════════════════════════════

describe("resolveSelectionScope", () => {
  it("returns null for none", () => {
    expect(resolveSelectionScope({ kind: "none" }, makeScore())).toBeNull();
  });

  it("returns a 1×1 rectangle for a single element", () => {
    const sel: Selection = { kind: "single", elementId: "p1/m1/s0/c1", elementType: "event" };
    expect(resolveSelectionScope(sel, makeScore())).toEqual({
      startMeasure: 1,
      endMeasure: 1,
      startPart: 1,
      endPart: 1,
      startVoice: 0,
      endVoice: 0,
    });
  });

  it("returns the bounding rectangle for multi", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/ev0", "p1/m1/s0/c1"] };
    expect(resolveSelectionScope(sel, makeScore())).toEqual({
      startMeasure: 0,
      endMeasure: 1,
      startPart: 0,
      endPart: 1,
      startVoice: 0,
      endVoice: 0,
    });
  });

  it("normalizes a measure rectangle (min/max)", () => {
    const sel: Selection = {
      kind: "measure",
      startPartIndex: 1,
      endPartIndex: 0,
      startStaffIndex: 0,
      endStaffIndex: 0,
      startMeasure: 1,
      endMeasure: 0,
    };
    expect(resolveSelectionScope(sel, makeScore())).toEqual({
      startMeasure: 0,
      endMeasure: 1,
      startPart: 0,
      endPart: 1,
      startVoice: 0,
      endVoice: 0,
    });
  });
});

describe("resolveSelectionAnchor", () => {
  it("uses elementId for single, startElementId for range, first for multi", () => {
    expect(resolveSelectionAnchor({ kind: "single", elementId: "a", elementType: "event" })).toBe("a");
    expect(resolveSelectionAnchor({ kind: "range", startElementId: "s", endElementId: "e" })).toBe("s");
    expect(resolveSelectionAnchor({ kind: "multi", elementIds: ["x", "y"] })).toBe("x");
    expect(resolveSelectionAnchor({ kind: "none" })).toBeNull();
    expect(
      resolveSelectionAnchor({
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 0,
        startStaffIndex: 0,
        endStaffIndex: 0,
        startMeasure: 0,
        endMeasure: 0,
      }),
    ).toBeNull();
  });
});

describe("resolveSelection (bundle)", () => {
  it("bundles every targeting shape", () => {
    const sel: Selection = { kind: "single", elementId: "p0/m0/s0/ev0", elementType: "event" };
    const resolved = resolveSelection(sel, makeScore());
    expect(resolved.kind).toBe("single");
    expect(resolved.events).toHaveLength(1);
    expect(resolved.elementIds).toEqual(["p0/m0/s0/ev0"]);
    expect(resolved.anchor).toBe("p0/m0/s0/ev0");
    expect(resolved.scope).not.toBeNull();
  });

  it("reports no element IDs for a measure selection (rectangle highlight)", () => {
    const sel: Selection = {
      kind: "measure",
      startPartIndex: 0,
      endPartIndex: 0,
      startStaffIndex: 0,
      endStaffIndex: 0,
      startMeasure: 0,
      endMeasure: 0,
    };
    expect(resolveSelection(sel, makeScore()).elementIds).toEqual([]);
  });
});

// ═══════════════════════════════════════════
// Capability contract
// ═══════════════════════════════════════════

describe("selection capabilities", () => {
  it("event actions accept all non-empty selection kinds", () => {
    for (const kind of ["single", "multi", "range", "measure"] as const) {
      expect(EVENT_ACTION.accepts.has(kind)).toBe(true);
    }
    expect(EVENT_ACTION.accepts.has("none" as never)).toBe(false);
  });

  it("anchor actions accept single only", () => {
    expect(selectionSupports(ANCHOR_ACTION, { kind: "single", elementId: "a", elementType: "event" })).toBe(true);
    expect(selectionSupports(ANCHOR_ACTION, { kind: "multi", elementIds: ["a", "b"] })).toBe(false);
  });

  it("fingering accepts multi/range (no longer single-only)", () => {
    expect(SELECTION_CAPABILITIES.fingering).toBe(EVENT_ACTION);
    expect(selectionSupports(SELECTION_CAPABILITIES.fingering, { kind: "multi", elementIds: ["a", "b"] })).toBe(true);
  });

  it("resolveCapabilityTargets returns events for an event action", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/ev0", "p0/m0/s0/ev1"] };
    const targets = resolveCapabilityTargets(EVENT_ACTION, sel, makeScore());
    expect(targets?.mode).toBe("events");
    expect(targets?.mode === "events" && targets.events).toHaveLength(2);
  });

  it("resolveCapabilityTargets returns scope for a scope action", () => {
    const sel: Selection = { kind: "single", elementId: "p0/m0/s0/ev0", elementType: "event" };
    const targets = resolveCapabilityTargets(SCOPE_ACTION, sel, makeScore());
    expect(targets?.mode).toBe("scope");
  });

  it("resolveCapabilityTargets returns null for unsupported kinds", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/ev0"] };
    expect(resolveCapabilityTargets(ANCHOR_ACTION, sel, makeScore())).toBeNull();
  });

  it("resolveCapabilityTargets returns null when there are no events", () => {
    expect(resolveCapabilityTargets(EVENT_ACTION, { kind: "none" }, makeScore())).toBeNull();
  });
});
