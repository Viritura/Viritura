import { describe, it, expect } from "vitest";
import type { Score, NoteEvent, Grace, Space } from "@viritura/core";
import { resolveEventLocation } from "../score/ElementPath";

// ═══════════════════════════════════════════
// Test helpers
// ═══════════════════════════════════════════

function makeNote(id: string | undefined, base: "whole" | "half" | "quarter" | "eighth"): NoteEvent {
  return {
    type: "event",
    ...(id ? { id } : {}),
    duration: { base },
    notes: [{ pitch: { step: "C", octave: 4 } }],
  } as NoteEvent;
}

function makeGrace(events: NoteEvent[]): Grace {
  return {
    type: "grace",
    content: events,
  };
}

function makeSpace(): Space {
  return {
    type: "space",
    duration: [1, 4],
  };
}

function makeScore(content: (NoteEvent | Grace | Space)[]): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 } }],
    },
    parts: [
      {
        name: "Test",
        measures: [
          {
            sequences: [{ content }],
          },
        ],
      },
    ],
  } as unknown as Score;
}

// ═══════════════════════════════════════════
// resolveEventLocation — grace note handling
// ═══════════════════════════════════════════

describe("resolveEventLocation with grace notes", () => {
  it("resolves e0 to the first regular event when grace precedes it", () => {
    // content: [Grace(B4), Event(C5)] — Rust generates e0 for the Event
    const score = makeScore([makeGrace([makeNote(undefined, "eighth")]), makeNote(undefined, "whole")]);
    const loc = resolveEventLocation("p0/m0/s0/e0", score);
    expect(loc).not.toBeNull();
    // Should resolve to content[1] (the regular event), NOT content[0] (the grace)
    expect(loc!.eventIndex).toBe(1);
  });

  it("resolves e1 to the second regular event when grace precedes both", () => {
    // content: [Grace, Event, Event]
    const score = makeScore([
      makeGrace([makeNote(undefined, "eighth")]),
      makeNote(undefined, "half"),
      makeNote(undefined, "half"),
    ]);
    const loc = resolveEventLocation("p0/m0/s0/e1", score);
    expect(loc).not.toBeNull();
    // Should resolve to content[2], NOT content[1]
    expect(loc!.eventIndex).toBe(2);
  });

  it("resolves correctly with multiple grace groups", () => {
    // content: [Grace, Event, Grace, Event]
    const score = makeScore([
      makeGrace([makeNote(undefined, "eighth")]),
      makeNote(undefined, "quarter"),
      makeGrace([makeNote(undefined, "eighth")]),
      makeNote(undefined, "quarter"),
    ]);
    // e0 → content[1] (first regular event)
    const loc0 = resolveEventLocation("p0/m0/s0/e0", score);
    expect(loc0).not.toBeNull();
    expect(loc0!.eventIndex).toBe(1);

    // e1 → content[3] (second regular event, skipping both graces)
    const loc1 = resolveEventLocation("p0/m0/s0/e1", score);
    expect(loc1).not.toBeNull();
    expect(loc1!.eventIndex).toBe(3);
  });

  it("resolves by explicit ID even when grace notes are present", () => {
    // When events have explicit IDs, the findIndex path is used
    const score = makeScore([makeGrace([makeNote(undefined, "eighth")]), makeNote("myEvent", "whole")]);
    const loc = resolveEventLocation("p0/m0/s0/myEvent", score);
    expect(loc).not.toBeNull();
    expect(loc!.eventIndex).toBe(1);
  });

  it("handles auto-generated __auto format with grace notes", () => {
    const score = makeScore([
      makeGrace([makeNote(undefined, "eighth")]),
      makeNote(undefined, "half"),
      makeNote(undefined, "half"),
    ]);
    // __auto_m0_v0_e0 → content[1]
    const loc = resolveEventLocation("p0/m0/s0/__auto_m0_v0_e0", score);
    expect(loc).not.toBeNull();
    expect(loc!.eventIndex).toBe(1);
  });
});

// ═══════════════════════════════════════════
// resolveEventLocation — space handling
// ═══════════════════════════════════════════

describe("resolveEventLocation with spaces", () => {
  it("resolves e0 correctly when space precedes the event", () => {
    // content: [Space, Event]
    const score = makeScore([makeSpace(), makeNote(undefined, "half")]);
    const loc = resolveEventLocation("p0/m0/s0/e0", score);
    expect(loc).not.toBeNull();
    expect(loc!.eventIndex).toBe(1);
  });

  it("resolves correctly with mixed grace and space entries", () => {
    // content: [Grace, Space, Event, Event]
    const score = makeScore([
      makeGrace([makeNote(undefined, "eighth")]),
      makeSpace(),
      makeNote(undefined, "quarter"),
      makeNote(undefined, "quarter"),
    ]);
    // e0 → content[2], e1 → content[3]
    const loc0 = resolveEventLocation("p0/m0/s0/e0", score);
    expect(loc0).not.toBeNull();
    expect(loc0!.eventIndex).toBe(2);

    const loc1 = resolveEventLocation("p0/m0/s0/e1", score);
    expect(loc1).not.toBeNull();
    expect(loc1!.eventIndex).toBe(3);
  });
});

// ═══════════════════════════════════════════
// resolveEventLocation — no grace/space (baseline)
// ═══════════════════════════════════════════

describe("resolveEventLocation baseline (no grace/space)", () => {
  it("resolves e0 and e1 to correct content indices", () => {
    const score = makeScore([makeNote(undefined, "half"), makeNote(undefined, "half")]);
    const loc0 = resolveEventLocation("p0/m0/s0/e0", score);
    expect(loc0).not.toBeNull();
    expect(loc0!.eventIndex).toBe(0);

    const loc1 = resolveEventLocation("p0/m0/s0/e1", score);
    expect(loc1).not.toBeNull();
    expect(loc1!.eventIndex).toBe(1);
  });
});
