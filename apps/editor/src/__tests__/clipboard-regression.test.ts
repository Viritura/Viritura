/**
 * Regression tests for multi-select, copy/paste, cut/paste, and
 * cross-staff clipboard operations.
 *
 * These tests exercise the full pipeline:
 *   Selection → resolveRangeElementIds → getClipboardSelection-like extraction
 *   → serialize → deserialize → assignFreshIds → applyPaste / applyCut
 *
 * Focus areas:
 *   - Auto-generated event IDs (__auto_ format, no explicit MNX IDs)
 *   - Multi-select (Ctrl+click) copy/paste
 *   - Range select copy/paste within same part
 *   - Cross-staff range copy/paste
 *   - Cut then paste
 *   - Duration integrity after paste
 *   - Paste overflow across measures
 *   - Double-paste (paste same content twice)
 */

import { describe, it, expect } from "vitest";
import type { Score, SequenceContent, TimeSignature, KeySignature, NoteEvent } from "@viritura/core";
import { DURATION_BEATS, isRest } from "@viritura/core";
import { serializeFragment } from "../clipboard/serialize";
import { deserializeFragment, assignFreshIds } from "../clipboard/deserialize";
import type { ClipboardTrack } from "../clipboard/ClipboardFragment";
import { applyPaste, applyCut, type PasteResult, type CutResult } from "../commands/clipboardCommands";
import { resolveRangeElementIds } from "../store/selectionUtils";
import { resolveEventLocation, eventSuffix } from "../score/ElementPath";
import { buildNavigationIndex, findEntryIndex } from "../navigation/NavigationIndex";

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

const defaultTime: TimeSignature = { count: 4, unit: 4 };
const defaultKey: KeySignature = { fifths: 0 };
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Make a note event WITH an explicit MNX id. */
function makeNote(
  id: string,
  step: "C" | "D" | "E" | "F" | "G" | "A" | "B",
  octave: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
  base: "whole" | "half" | "quarter" | "eighth" = "quarter",
): SequenceContent {
  return {
    type: "event",
    id,
    duration: { base },
    notes: [{ id: `${id}-n0`, pitch: { step, octave } }],
  };
}

/** Make a note event WITHOUT an explicit MNX id (like MNX files loaded from disk). */
function makeAnonymousNote(
  step: "C" | "D" | "E" | "F" | "G" | "A" | "B",
  octave: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
  base: "whole" | "half" | "quarter" | "eighth" = "quarter",
): SequenceContent {
  return {
    type: "event",
    duration: { base },
    notes: [{ pitch: { step, octave } }],
  };
}

function makeRest(base: "whole" | "half" | "quarter" | "eighth" = "quarter"): SequenceContent {
  return { type: "event", duration: { base }, rest: {} };
}

/** Compute total beats in a sequence content array. */
function totalBeats(content: SequenceContent[]): number {
  return content.reduce((sum, ev) => {
    const base = (DURATION_BEATS as Record<string, number>)[ev.duration?.base ?? ""] ?? 0;
    let beats = base;
    if (ev.duration?.dots) {
      let dot = beats / 2;
      for (let d = 0; d < ev.duration.dots; d++) {
        beats += dot;
        dot /= 2;
      }
    }
    return sum + beats;
  }, 0);
}

/** Build a PasteResult from raw content. */
function makePaste(content: SequenceContent[], tracks?: ClipboardTrack[]): PasteResult {
  return {
    content,
    sourceTimeSignature: defaultTime,
    sourceKeySignature: defaultKey,
    tracks,
  };
}

/** Full serialize → deserialize → assignFreshIds round trip. */
function roundTrip(events: SequenceContent[], tracks?: ClipboardTrack[]): PasteResult {
  const json = serializeFragment(events, defaultTime, defaultKey, tracks);
  const fragment = deserializeFragment(json)!;
  expect(fragment).not.toBeNull();
  return {
    content: assignFreshIds(fragment.content),
    sourceTimeSignature: fragment.timeSignature,
    sourceKeySignature: fragment.keySignature,
    tracks: fragment.tracks?.map((t) => ({
      ...t,
      content: assignFreshIds(t.content),
    })),
  };
}

// ═══════════════════════════════════════════
// Score fixtures
// ═══════════════════════════════════════════

/** Single part, 2 measures, 4 quarter notes each, all with explicit IDs. */
function makeIdScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: defaultTime }, {}] },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [
                  makeNote("ev-a", "C", 4),
                  makeNote("ev-b", "D", 4),
                  makeNote("ev-c", "E", 4),
                  makeNote("ev-d", "F", 4),
                ],
              },
            ],
          },
          {
            sequences: [
              {
                content: [
                  makeNote("ev-e", "G", 4),
                  makeNote("ev-f", "A", 4),
                  makeNote("ev-g", "B", 4),
                  makeNote("ev-h", "C", 5),
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Single part, 2 measures, anonymous events (no explicit MNX IDs). */
function makeAnonScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: defaultTime }, {}] },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [
                  makeAnonymousNote("C", 4),
                  makeAnonymousNote("D", 4),
                  makeAnonymousNote("E", 4),
                  makeAnonymousNote("F", 4),
                ],
              },
            ],
          },
          {
            sequences: [
              {
                content: [
                  makeAnonymousNote("G", 4),
                  makeAnonymousNote("A", 4),
                  makeAnonymousNote("B", 4),
                  makeAnonymousNote("C", 5),
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Two parts (Violin + Cello), 2 measures each, explicit IDs. */
function makeTwoPartIdScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: defaultTime }, {}] },
    parts: [
      {
        name: "Violin",
        measures: [
          {
            sequences: [
              {
                content: [
                  makeNote("v-a", "C", 5),
                  makeNote("v-b", "D", 5),
                  makeNote("v-c", "E", 5),
                  makeNote("v-d", "F", 5),
                ],
              },
            ],
          },
          {
            sequences: [
              {
                content: [
                  makeNote("v-e", "G", 5),
                  makeNote("v-f", "A", 5),
                  makeNote("v-g", "B", 5),
                  makeNote("v-h", "C", 6),
                ],
              },
            ],
          },
        ],
      },
      {
        name: "Cello",
        measures: [
          {
            sequences: [
              {
                content: [
                  makeNote("c-a", "C", 3),
                  makeNote("c-b", "D", 3),
                  makeNote("c-c", "E", 3),
                  makeNote("c-d", "F", 3),
                ],
              },
            ],
          },
          {
            sequences: [
              {
                content: [
                  makeNote("c-e", "G", 3),
                  makeNote("c-f", "A", 3),
                  makeNote("c-g", "B", 3),
                  makeNote("c-h", "C", 4),
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Two parts, anonymous events. */
function makeTwoPartAnonScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: defaultTime }, {}] },
    parts: [
      {
        name: "Violin",
        measures: [
          {
            sequences: [
              {
                content: [
                  makeAnonymousNote("C", 5),
                  makeAnonymousNote("D", 5),
                  makeAnonymousNote("E", 5),
                  makeAnonymousNote("F", 5),
                ],
              },
            ],
          },
          {
            sequences: [
              {
                content: [makeAnonymousNote("G", 5, "whole")],
              },
            ],
          },
        ],
      },
      {
        name: "Cello",
        measures: [
          {
            sequences: [
              {
                content: [
                  makeAnonymousNote("C", 3),
                  makeAnonymousNote("D", 3),
                  makeAnonymousNote("E", 3),
                  makeAnonymousNote("F", 3),
                ],
              },
            ],
          },
          {
            sequences: [
              {
                content: [makeAnonymousNote("G", 3, "whole")],
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Grand staff (piano): one part, two voices per measure. */
function makeGrandStaffScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: defaultTime }, {}] },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [
                  makeNote("rh-a", "C", 5),
                  makeNote("rh-b", "D", 5),
                  makeNote("rh-c", "E", 5),
                  makeNote("rh-d", "F", 5),
                ],
              },
              {
                content: [
                  makeNote("lh-a", "C", 3),
                  makeNote("lh-b", "D", 3),
                  makeNote("lh-c", "E", 3),
                  makeNote("lh-d", "F", 3),
                ],
              },
            ],
          },
          {
            sequences: [
              { content: [makeNote("rh-e", "G", 5, "whole")] },
              { content: [makeNote("lh-e", "G", 3, "whole")] },
            ],
          },
        ],
      },
    ],
  };
}

// ═══════════════════════════════════════════
// Navigation index + auto-generated IDs
// ═══════════════════════════════════════════

describe("Navigation index with auto-generated IDs", () => {
  it("generates __auto_ IDs for anonymous events", () => {
    const score = makeAnonScore();
    const nav = buildNavigationIndex(score);
    const eventEntries = nav.entries.filter((e) => e.elementType === "event" || e.elementType === "rest");
    // All events should have __auto_ format IDs
    for (const entry of eventEntries) {
      expect(entry.elementId).toMatch(/p\d+\/m\d+\/s\d+\/__auto_m\d+_v\d+_e\d+/);
    }
  });

  it("generates model-ID-based IDs for events with explicit IDs", () => {
    const score = makeIdScore();
    const nav = buildNavigationIndex(score);
    const eventEntries = nav.entries.filter((e) => e.elementType === "event" || e.elementType === "rest");
    for (const entry of eventEntries) {
      expect(entry.elementId).not.toContain("__auto_");
    }
  });

  it("resolveEventLocation works with __auto_ IDs", () => {
    const score = makeAnonScore();
    // p0/m0/s0/__auto_m0_v0_e2 → third event in first measure
    const loc = resolveEventLocation("p0/m0/s0/__auto_m0_v0_e2", score);
    expect(loc).not.toBeNull();
    expect(loc!.partIndex).toBe(0);
    expect(loc!.measureIndex).toBe(0);
    expect(loc!.sequenceIndex).toBe(0);
    expect(loc!.eventIndex).toBe(2);
  });

  it("resolveEventLocation works with explicit model IDs", () => {
    const score = makeIdScore();
    const loc = resolveEventLocation("p0/m0/s0/ev-c", score);
    expect(loc).not.toBeNull();
    expect(loc!.eventIndex).toBe(2);
  });

  it("findEntryIndex finds auto-generated IDs in nav index", () => {
    const score = makeAnonScore();
    const nav = buildNavigationIndex(score);
    const idx = findEntryIndex(nav, "p0/m0/s0/__auto_m0_v0_e0");
    expect(idx).not.toBe(-1);
  });

  it("findEntryIndex finds model IDs in nav index", () => {
    const score = makeIdScore();
    const nav = buildNavigationIndex(score);
    const idx = findEntryIndex(nav, "p0/m0/s0/ev-a");
    expect(idx).not.toBe(-1);
  });
});

// ═══════════════════════════════════════════
// Range selection → element ID resolution (auto IDs)
// ═══════════════════════════════════════════

describe("resolveRangeElementIds with auto-generated IDs", () => {
  it("resolves contiguous range in same voice with __auto_ IDs", () => {
    const score = makeAnonScore();
    const ids = resolveRangeElementIds("p0/m0/s0/__auto_m0_v0_e1", "p0/m0/s0/__auto_m0_v0_e3", score);
    expect(ids).toHaveLength(3);
    expect(ids).toContain("p0/m0/s0/__auto_m0_v0_e1");
    expect(ids).toContain("p0/m0/s0/__auto_m0_v0_e2");
    expect(ids).toContain("p0/m0/s0/__auto_m0_v0_e3");
    // Should NOT include event 0
    expect(ids).not.toContain("p0/m0/s0/__auto_m0_v0_e0");
  });

  it("resolves cross-measure range with __auto_ IDs", () => {
    const score = makeAnonScore();
    const ids = resolveRangeElementIds("p0/m0/s0/__auto_m0_v0_e2", "p0/m1/s0/__auto_m1_v0_e1", score);
    // m0: events 2,3 + m1: events 0,1
    expect(ids).toContain("p0/m0/s0/__auto_m0_v0_e2");
    expect(ids).toContain("p0/m0/s0/__auto_m0_v0_e3");
    expect(ids).toContain("p0/m1/s0/__auto_m1_v0_e0");
    expect(ids).toContain("p0/m1/s0/__auto_m1_v0_e1");
    expect(ids).toHaveLength(4);
  });

  it("resolves cross-staff range with __auto_ IDs", () => {
    const score = makeTwoPartAnonScore();
    // Select from violin m0 e1 to cello m0 e2
    const ids = resolveRangeElementIds("p0/m0/s0/__auto_m0_v0_e1", "p1/m0/s0/__auto_m0_v0_e2", score);
    // Both parts, events between beat 1 and beat 2 (inclusive)
    expect(ids).toContain("p0/m0/s0/__auto_m0_v0_e1");
    expect(ids).toContain("p0/m0/s0/__auto_m0_v0_e2");
    expect(ids).toContain("p1/m0/s0/__auto_m0_v0_e1");
    expect(ids).toContain("p1/m0/s0/__auto_m0_v0_e2");
    // event 0 starts before beat 1 — should be excluded
    expect(ids).not.toContain("p0/m0/s0/__auto_m0_v0_e0");
    expect(ids).not.toContain("p1/m0/s0/__auto_m0_v0_e0");
  });
});

// ═══════════════════════════════════════════
// Single-part range → copy → paste round-trip
// ═══════════════════════════════════════════

describe("single-part range copy → paste round-trip", () => {
  it("copies 2 quarter notes and pastes into another measure", () => {
    const score = makeIdScore();
    // Select ev-b and ev-c (D4 and E4 in m0)
    const ids = resolveRangeElementIds("p0/m0/s0/ev-b", "p0/m0/s0/ev-c", score);
    expect(ids).toHaveLength(2);

    // Extract events for clipboard
    const events = ids.map((id) => {
      const loc = resolveEventLocation(id, score)!;
      return score.parts[loc.partIndex]!.measures[loc.measureIndex]!.sequences[loc.sequenceIndex]!.content[
        loc.eventIndex
      ]!;
    });
    expect(events).toHaveLength(2);
    expect(events[0]!.notes![0]!.pitch.step).toBe("D");
    expect(events[1]!.notes![0]!.pitch.step).toBe("E");

    // Round-trip through serialization
    const paste = roundTrip(events);

    // Paste at m1 event 0
    const result = applyPaste(score, paste, 0, 1, 0, 0);
    const m1 = result.parts[0]!.measures[1]!.sequences[0]!.content;
    expect(m1[0]!.notes![0]!.pitch.step).toBe("D");
    expect(m1[1]!.notes![0]!.pitch.step).toBe("E");
    expect(totalBeats(m1)).toBeCloseTo(4, 5);
  });

  it("copies from anonymous score and pastes correctly", () => {
    const score = makeAnonScore();
    const ids = resolveRangeElementIds("p0/m0/s0/__auto_m0_v0_e0", "p0/m0/s0/__auto_m0_v0_e1", score);
    expect(ids).toHaveLength(2);

    const events = ids.map((id) => {
      const loc = resolveEventLocation(id, score)!;
      return score.parts[loc.partIndex]!.measures[loc.measureIndex]!.sequences[loc.sequenceIndex]!.content[
        loc.eventIndex
      ]!;
    });
    expect(events[0]!.notes![0]!.pitch.step).toBe("C");
    expect(events[1]!.notes![0]!.pitch.step).toBe("D");

    const paste = roundTrip(events);
    const result = applyPaste(score, paste, 0, 1, 0, 0);
    const m1 = result.parts[0]!.measures[1]!.sequences[0]!.content;
    expect(m1[0]!.notes![0]!.pitch.step).toBe("C");
    expect(m1[1]!.notes![0]!.pitch.step).toBe("D");
    expect(totalBeats(m1)).toBeCloseTo(4, 5);
  });

  it("paste assigns fresh IDs that differ from source", () => {
    const score = makeIdScore();
    const events = [score.parts[0]!.measures[0]!.sequences[0]!.content[0]!];

    const paste = roundTrip(events);
    const result = applyPaste(score, paste, 0, 1, 0, 0);
    const pasted = result.parts[0]!.measures[1]!.sequences[0]!.content[0]!;

    // Fresh ID should be assigned
    expect(pasted.id).toBeDefined();
    expect(pasted.id).not.toBe("ev-a");
    expect(pasted.id).toMatch(UUID_V7);
    expect(pasted.notes![0]!.id).toMatch(UUID_V7);
  });

  it("pastes across measure boundary", () => {
    const score = makeIdScore();
    // Copy 4 quarters from m0 (full measure)
    const events = score.parts[0]!.measures[0]!.sequences[0]!.content.slice();
    const paste = roundTrip(events);

    // Paste at m0 event 2 (beat 2) → 2 events fit in m0, 2 overflow to m1
    const result = applyPaste(score, paste, 0, 0, 0, 2);
    const m0 = result.parts[0]!.measures[0]!.sequences[0]!.content;
    const m1 = result.parts[0]!.measures[1]!.sequences[0]!.content;
    expect(totalBeats(m0)).toBeCloseTo(4, 5);
    expect(totalBeats(m1)).toBeCloseTo(4, 5);
  });

  it("double-paste produces consistent result", () => {
    const score = makeIdScore();
    const events = [makeNote("x", "A", 5)];
    const paste1 = roundTrip(events);
    const result1 = applyPaste(score, paste1, 0, 0, 0, 0);

    // Paste again at same position on the already-pasted score
    const paste2 = roundTrip([makeNote("y", "B", 5)]);
    const result2 = applyPaste(result1, paste2, 0, 0, 0, 0);

    const m0 = result2.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(m0[0]!.notes![0]!.pitch.step).toBe("B");
    expect(totalBeats(m0)).toBeCloseTo(4, 5);
  });
});

// ═══════════════════════════════════════════
// Cross-staff range → copy → paste round-trip
// ═══════════════════════════════════════════

describe("cross-staff range copy → paste round-trip", () => {
  it("copies from two parts and pastes via multi-track", () => {
    const score = makeTwoPartIdScore();
    // Select from violin m0 to cello m0 (same measure, all events)
    const ids = resolveRangeElementIds("p0/m0/s0/v-a", "p1/m0/s0/c-d", score);

    // Group events by part for multi-track clipboard
    const part0Events: SequenceContent[] = [];
    const part1Events: SequenceContent[] = [];
    for (const id of ids) {
      const loc = resolveEventLocation(id, score)!;
      const ev =
        score.parts[loc.partIndex]!.measures[loc.measureIndex]!.sequences[loc.sequenceIndex]!.content[loc.eventIndex]!;
      if (loc.partIndex === 0) part0Events.push(ev);
      else part1Events.push(ev);
    }

    const tracks: ClipboardTrack[] = [
      { partOffset: 0, voiceIndex: 0, content: part0Events },
      { partOffset: 1, voiceIndex: 0, content: part1Events },
    ];

    const paste = roundTrip(part0Events, tracks);

    // Paste at m1 (both parts)
    const result = applyPaste(score, paste, 0, 1, 0, 0);

    // Violin m1 should have pasted content
    const vm1 = result.parts[0]!.measures[1]!.sequences[0]!.content;
    expect(vm1[0]!.notes![0]!.pitch.step).toBe("C");
    expect(totalBeats(vm1)).toBeCloseTo(4, 5);

    // Cello m1 should have pasted content
    const cm1 = result.parts[1]!.measures[1]!.sequences[0]!.content;
    expect(cm1[0]!.notes![0]!.pitch.step).toBe("C");
    expect(totalBeats(cm1)).toBeCloseTo(4, 5);
  });

  it("cross-staff paste with anonymous events", () => {
    const score = makeTwoPartAnonScore();
    // Build __auto_ IDs for selection
    const ids = resolveRangeElementIds("p0/m0/s0/__auto_m0_v0_e0", "p1/m0/s0/__auto_m0_v0_e3", score);
    expect(ids.length).toBeGreaterThan(0);

    // Verify we got events from both parts
    const p0Ids = ids.filter((id) => id.startsWith("p0/"));
    const p1Ids = ids.filter((id) => id.startsWith("p1/"));
    expect(p0Ids.length).toBeGreaterThan(0);
    expect(p1Ids.length).toBeGreaterThan(0);

    // Extract and paste
    const p0Events = p0Ids.map((id) => {
      const loc = resolveEventLocation(id, score)!;
      return score.parts[loc.partIndex]!.measures[loc.measureIndex]!.sequences[loc.sequenceIndex]!.content[
        loc.eventIndex
      ]!;
    });
    const p1Events = p1Ids.map((id) => {
      const loc = resolveEventLocation(id, score)!;
      return score.parts[loc.partIndex]!.measures[loc.measureIndex]!.sequences[loc.sequenceIndex]!.content[
        loc.eventIndex
      ]!;
    });

    const tracks: ClipboardTrack[] = [
      { partOffset: 0, voiceIndex: 0, content: p0Events },
      { partOffset: 1, voiceIndex: 0, content: p1Events },
    ];
    const paste = roundTrip(p0Events, tracks);
    const result = applyPaste(score, paste, 0, 1, 0, 0);

    expect(totalBeats(result.parts[0]!.measures[1]!.sequences[0]!.content)).toBeCloseTo(4, 5);
    expect(totalBeats(result.parts[1]!.measures[1]!.sequences[0]!.content)).toBeCloseTo(4, 5);
  });

  it("multi-track paste does not corrupt uninvolved parts", () => {
    // 3-part score: Flute, Violin, Cello
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: defaultTime }] },
      parts: [
        { name: "Flute", measures: [{ sequences: [{ content: [makeNote("fl", "C", 6, "whole")] }] }] },
        { name: "Violin", measures: [{ sequences: [{ content: [makeNote("vn", "C", 5, "whole")] }] }] },
        { name: "Cello", measures: [{ sequences: [{ content: [makeNote("vc", "C", 3, "whole")] }] }] },
      ],
    };

    // Paste into Flute and Violin only (tracks with offsets 0 and 1)
    const paste = makePaste(
      [makeNote("x", "A", 5, "whole")],
      [
        { partOffset: 0, voiceIndex: 0, content: [makeNote("x1", "A", 6, "whole")] },
        { partOffset: 1, voiceIndex: 0, content: [makeNote("x2", "A", 5, "whole")] },
      ],
    );

    const result = applyPaste(score, paste, 0, 0, 0, 0);
    // Flute and Violin updated
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes![0]!.pitch.step).toBe("A");
    expect(result.parts[1]!.measures[0]!.sequences[0]!.content[0]!.notes![0]!.pitch.step).toBe("A");
    // Cello unchanged
    expect(result.parts[2]!.measures[0]!.sequences[0]!.content[0]!.notes![0]!.pitch.step).toBe("C");
    expect(result.parts[2]!.measures[0]!.sequences[0]!.content[0]!.notes![0]!.pitch.octave).toBe(3);
  });
});

// ═══════════════════════════════════════════
// Grand staff (multi-voice within same part)
// ═══════════════════════════════════════════

describe("grand staff copy → paste", () => {
  it("copies both voices and pastes via multi-track within same part", () => {
    const score = makeGrandStaffScore();
    // Extract RH and LH from m0
    const rhEvents = score.parts[0]!.measures[0]!.sequences[0]!.content.slice();
    const lhEvents = score.parts[0]!.measures[0]!.sequences[1]!.content.slice();

    const tracks: ClipboardTrack[] = [
      { partOffset: 0, voiceIndex: 0, content: rhEvents },
      { partOffset: 0, voiceIndex: 1, content: lhEvents },
    ];

    const paste = roundTrip(rhEvents, tracks);
    const result = applyPaste(score, paste, 0, 1, 0, 0);

    // RH of m1 should have pasted content
    const rh1 = result.parts[0]!.measures[1]!.sequences[0]!.content;
    expect(rh1[0]!.notes![0]!.pitch.step).toBe("C");
    expect(rh1[0]!.notes![0]!.pitch.octave).toBe(5);
    expect(totalBeats(rh1)).toBeCloseTo(4, 5);

    // LH of m1 should have pasted content
    const lh1 = result.parts[0]!.measures[1]!.sequences[1]!.content;
    expect(lh1[0]!.notes![0]!.pitch.step).toBe("C");
    expect(lh1[0]!.notes![0]!.pitch.octave).toBe(3);
    expect(totalBeats(lh1)).toBeCloseTo(4, 5);
  });
});

// ═══════════════════════════════════════════
// Cut → paste integration
// ═══════════════════════════════════════════

describe("cut → paste integration", () => {
  it("cut replaces notes with rests, paste inserts them elsewhere", () => {
    const score = makeIdScore();
    // Cut events at m0 positions 1 and 2 (D4, E4)
    const cutEvents = score.parts[0]!.measures[0]!.sequences[0]!.content.slice(1, 3);
    const cut: CutResult = {
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 1,
      replacements: cutEvents.map((ev) => ({
        type: "event" as const,
        duration: { ...ev.duration },
        rest: {},
      })),
    };

    const afterCut = applyCut(score, cut);

    // Verify cut measure has rests at positions 1 and 2
    const m0 = afterCut.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(m0[0]!.notes![0]!.pitch.step).toBe("C"); // preserved
    expect(isRest(m0[1]! as NoteEvent)).toBe(true); // rest
    expect(isRest(m0[2]! as NoteEvent)).toBe(true); // rest
    expect(m0[3]!.notes![0]!.pitch.step).toBe("F"); // preserved

    // Now paste the cut content into m1
    const paste = roundTrip(cutEvents);
    const afterPaste = applyPaste(afterCut, paste, 0, 1, 0, 0);

    const m1 = afterPaste.parts[0]!.measures[1]!.sequences[0]!.content;
    expect(m1[0]!.notes![0]!.pitch.step).toBe("D");
    expect(m1[1]!.notes![0]!.pitch.step).toBe("E");
    expect(totalBeats(m1)).toBeCloseTo(4, 5);
  });

  it("cut does not mutate original score", () => {
    const score = makeIdScore();
    const originalStep = (score.parts[0]!.measures[0]!.sequences[0]!.content[1]! as NoteEvent).notes![0]!.pitch.step;

    const cut: CutResult = {
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 1,
      replacements: [makeRest()],
    };
    applyCut(score, cut);

    // Original score untouched
    expect((score.parts[0]!.measures[0]!.sequences[0]!.content[1]! as NoteEvent).notes![0]!.pitch.step).toBe(
      originalStep,
    );
  });

  it("cut with invalid indices returns unchanged score", () => {
    const score = makeIdScore();
    const cut: CutResult = {
      partIndex: 99,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
      replacements: [makeRest()],
    };
    const result = applyCut(score, cut);
    expect(result).toEqual(score);
  });
});

// ═══════════════════════════════════════════
// Multi-select (Ctrl+click) copy/paste
// ═══════════════════════════════════════════

describe("multi-select copy → paste", () => {
  it("copies non-contiguous events by resolving each individually", () => {
    const score = makeIdScore();
    // Ctrl+click selects ev-a (C4) and ev-d (F4) — non-contiguous
    const multiIds = ["p0/m0/s0/ev-a", "p0/m0/s0/ev-d"];

    const events = multiIds.map((id) => {
      const loc = resolveEventLocation(id, score)!;
      expect(loc).not.toBeNull();
      return score.parts[loc.partIndex]!.measures[loc.measureIndex]!.sequences[loc.sequenceIndex]!.content[
        loc.eventIndex
      ]!;
    });

    expect(events[0]!.notes![0]!.pitch.step).toBe("C");
    expect(events[1]!.notes![0]!.pitch.step).toBe("F");

    // Serialize and paste
    const paste = roundTrip(events);
    const result = applyPaste(score, paste, 0, 1, 0, 0);
    const m1 = result.parts[0]!.measures[1]!.sequences[0]!.content;

    // Pasted content: C4 quarter, F4 quarter at beginning of m1
    expect(m1[0]!.notes![0]!.pitch.step).toBe("C");
    expect(m1[1]!.notes![0]!.pitch.step).toBe("F");
    expect(totalBeats(m1)).toBeCloseTo(4, 5);
  });

  it("copies non-contiguous events with anonymous IDs", () => {
    const score = makeAnonScore();
    // Select event 0 and event 3 from m0
    const multiIds = ["p0/m0/s0/__auto_m0_v0_e0", "p0/m0/s0/__auto_m0_v0_e3"];

    const events = multiIds.map((id) => {
      const loc = resolveEventLocation(id, score)!;
      expect(loc).not.toBeNull();
      return score.parts[loc.partIndex]!.measures[loc.measureIndex]!.sequences[loc.sequenceIndex]!.content[
        loc.eventIndex
      ]!;
    });

    expect(events[0]!.notes![0]!.pitch.step).toBe("C");
    expect(events[1]!.notes![0]!.pitch.step).toBe("F");

    const paste = roundTrip(events);
    const result = applyPaste(score, paste, 0, 1, 0, 0);
    const m1 = result.parts[0]!.measures[1]!.sequences[0]!.content;
    expect(m1[0]!.notes![0]!.pitch.step).toBe("C");
    expect(m1[1]!.notes![0]!.pitch.step).toBe("F");
  });

  it("multi-select across measures copies events from different measures", () => {
    const score = makeIdScore();
    // Ctrl+click: ev-b from m0 and ev-f from m1
    const multiIds = ["p0/m0/s0/ev-b", "p0/m1/s0/ev-f"];

    const events = multiIds.map((id) => {
      const loc = resolveEventLocation(id, score)!;
      return score.parts[loc.partIndex]!.measures[loc.measureIndex]!.sequences[loc.sequenceIndex]!.content[
        loc.eventIndex
      ]!;
    });

    expect(events[0]!.notes![0]!.pitch.step).toBe("D");
    expect(events[1]!.notes![0]!.pitch.step).toBe("A");

    const paste = roundTrip(events);
    const result = applyPaste(score, paste, 0, 0, 0, 0);
    const m0 = result.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(m0[0]!.notes![0]!.pitch.step).toBe("D");
    expect(m0[1]!.notes![0]!.pitch.step).toBe("A");
    expect(totalBeats(m0)).toBeCloseTo(4, 5);
  });

  it("multi-select across parts copies events from different parts", () => {
    const score = makeTwoPartIdScore();
    // Ctrl+click: violin event and cello event
    const multiIds = ["p0/m0/s0/v-a", "p1/m0/s0/c-c"];

    const events = multiIds.map((id) => {
      const loc = resolveEventLocation(id, score)!;
      return score.parts[loc.partIndex]!.measures[loc.measureIndex]!.sequences[loc.sequenceIndex]!.content[
        loc.eventIndex
      ]!;
    });

    expect(events[0]!.notes![0]!.pitch.step).toBe("C");
    expect(events[0]!.notes![0]!.pitch.octave).toBe(5);
    expect(events[1]!.notes![0]!.pitch.step).toBe("E");
    expect(events[1]!.notes![0]!.pitch.octave).toBe(3);

    // When pasted as single-track (flattened), both events go into same voice
    const paste = roundTrip(events);
    const result = applyPaste(score, paste, 0, 1, 0, 0);
    const m1 = result.parts[0]!.measures[1]!.sequences[0]!.content;
    expect(m1[0]!.notes![0]!.pitch.step).toBe("C");
    expect(m1[1]!.notes![0]!.pitch.step).toBe("E");
  });
});

// ═══════════════════════════════════════════
// Paste duration edge cases
// ═══════════════════════════════════════════

describe("paste duration edge cases", () => {
  it("pasting a half note at the last beat of a measure overflows correctly", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: defaultTime }, {}] },
      parts: [
        {
          name: "Piano",
          measures: [
            { sequences: [{ content: [makeNote("a", "C", 4, "whole")] }] },
            { sequences: [{ content: [makeNote("b", "D", 4, "whole")] }] },
          ],
        },
      ],
    };

    // Paste a half note at event 0 (beat 0) — should consume 2 beats of the whole
    const paste = makePaste([makeNote("x", "G", 5, "half")]);
    const result = applyPaste(score, paste, 0, 0, 0, 0);
    const m0 = result.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(m0[0]!.notes![0]!.pitch.step).toBe("G");
    expect(m0[0]!.duration.base).toBe("half");
    expect(totalBeats(m0)).toBeCloseTo(4, 5);
  });

  it("pasting dotted quarter preserves dotted duration", () => {
    const event: SequenceContent = {
      type: "event",
      duration: { base: "quarter", dots: 1 },
      notes: [{ pitch: { step: "A", octave: 4 } }],
    };
    const paste = roundTrip([event]);
    expect(paste.content[0]!.duration.dots).toBe(1);
  });

  it("pasting eighth notes into a measure with quarter notes", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: defaultTime }] },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              sequences: [
                {
                  content: [makeNote("a", "C", 4), makeNote("b", "D", 4), makeNote("c", "E", 4), makeNote("d", "F", 4)],
                },
              ],
            },
          ],
        },
      ],
    };

    // Paste 2 eighths at position 0 — should consume 1 quarter note
    const paste = makePaste([makeNote("x", "A", 5, "eighth"), makeNote("y", "B", 5, "eighth")]);
    const result = applyPaste(score, paste, 0, 0, 0, 0);
    const m0 = result.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(m0[0]!.notes![0]!.pitch.step).toBe("A");
    expect(m0[1]!.notes![0]!.pitch.step).toBe("B");
    expect(totalBeats(m0)).toBeCloseTo(4, 5);
  });

  it("paste that exactly fills a measure leaves no extra beats", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: defaultTime }] },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              sequences: [{ content: [makeNote("a", "C", 4, "whole")] }],
            },
          ],
        },
      ],
    };

    // Paste exactly 4 beats
    const paste = makePaste([
      makeNote("x1", "A", 5),
      makeNote("x2", "B", 5),
      makeNote("x3", "C", 6),
      makeNote("x4", "D", 6),
    ]);
    const result = applyPaste(score, paste, 0, 0, 0, 0);
    const m0 = result.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(totalBeats(m0)).toBeCloseTo(4, 5);
    expect(m0).toHaveLength(4);
  });
});

// ═══════════════════════════════════════════
// Paste auto-append measures
// ═══════════════════════════════════════════

describe("paste auto-append measures", () => {
  it("auto-appends measures when paste overflows last measure", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: defaultTime }] },
      parts: [
        {
          name: "Piano",
          measures: [{ sequences: [{ content: [makeNote("a", "C", 4, "whole")] }] }],
        },
      ],
    };

    // Paste 12 beats (3 measures worth) into 1-measure score
    const paste = makePaste([
      makeNote("x1", "A", 5, "whole"),
      makeNote("x2", "B", 5, "whole"),
      makeNote("x3", "C", 6, "whole"),
    ]);
    const result = applyPaste(score, paste, 0, 0, 0, 0);

    expect(result.global.measures).toHaveLength(3);
    expect(result.parts[0]!.measures).toHaveLength(3);
    for (let m = 0; m < 3; m++) {
      expect(totalBeats(result.parts[0]!.measures[m]!.sequences[0]!.content)).toBeCloseTo(4, 5);
    }
  });

  it("auto-append creates empty measures for all parts", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: defaultTime }] },
      parts: [
        { name: "Violin", measures: [{ sequences: [{ content: [makeNote("v", "C", 5, "whole")] }] }] },
        { name: "Cello", measures: [{ sequences: [{ content: [makeNote("c", "C", 3, "whole")] }] }] },
      ],
    };

    // Paste 8 beats into violin (1 measure + overflow)
    const paste = makePaste([makeNote("x1", "A", 5, "whole"), makeNote("x2", "B", 5, "whole")]);
    const result = applyPaste(score, paste, 0, 0, 0, 0);

    // Both parts should have 2 measures
    expect(result.parts[0]!.measures).toHaveLength(2);
    expect(result.parts[1]!.measures).toHaveLength(2);
    // Cello's original measure untouched
    expect(result.parts[1]!.measures[0]!.sequences[0]!.content[0]!.notes![0]!.pitch.step).toBe("C");
  });
});

// ═══════════════════════════════════════════
// Immutability guarantees
// ═══════════════════════════════════════════

describe("immutability guarantees", () => {
  it("applyPaste does not mutate input score", () => {
    const score = makeIdScore();
    const originalM0Content = JSON.stringify(score.parts[0]!.measures[0]!.sequences[0]!.content);

    const paste = makePaste([makeNote("x", "Z" as "A", 5, "whole")]);
    applyPaste(score, paste, 0, 0, 0, 0);

    expect(JSON.stringify(score.parts[0]!.measures[0]!.sequences[0]!.content)).toBe(originalM0Content);
  });

  it("applyCut does not mutate input score", () => {
    const score = makeIdScore();
    const originalM0Content = JSON.stringify(score.parts[0]!.measures[0]!.sequences[0]!.content);

    const cut: CutResult = {
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
      replacements: [makeRest()],
    };
    applyCut(score, cut);

    expect(JSON.stringify(score.parts[0]!.measures[0]!.sequences[0]!.content)).toBe(originalM0Content);
  });

  it("assignFreshIds does not mutate the input array", () => {
    const events: SequenceContent[] = [makeNote("orig", "C", 4)];
    const origId = events[0]!.id;
    assignFreshIds(events);
    expect(events[0]!.id).toBe(origId);
  });
});

// ═══════════════════════════════════════════
// Serialization edge cases
// ═══════════════════════════════════════════

describe("serialization edge cases", () => {
  it("preserves ties in serialized content", () => {
    const event: SequenceContent = {
      type: "event",
      id: "tied",
      duration: { base: "quarter" },
      notes: [
        {
          pitch: { step: "C", octave: 4 },
          ties: [{ target: "other" }],
        },
      ],
    };
    const json = serializeFragment([event], defaultTime, defaultKey);
    const parsed = JSON.parse(json);
    expect(parsed.content[0].notes[0].ties).toHaveLength(1);
    expect(parsed.content[0].notes[0].ties[0].target).toBe("other");
  });

  it("preserves slurs in serialized content", () => {
    const event: SequenceContent = {
      type: "event",
      id: "slurred",
      duration: { base: "quarter" },
      notes: [{ pitch: { step: "C", octave: 4 } }],
      slurs: [{ target: "other" }],
    };
    const json = serializeFragment([event], defaultTime, defaultKey);
    const parsed = JSON.parse(json);
    expect(parsed.content[0].slurs).toHaveLength(1);
    expect(parsed.content[0].slurs[0].target).toBe("other");
  });

  it("preserves articulations through round-trip", () => {
    const event: SequenceContent = {
      type: "event",
      id: "artic",
      duration: { base: "quarter" },
      notes: [{ pitch: { step: "C", octave: 4 } }],
      articulations: [{ type: "staccato" }],
    };
    const paste = roundTrip([event]);
    expect(paste.content[0]!.articulations).toEqual([{ type: "staccato" }]);
  });

  it("round-trips multi-track fragments correctly", () => {
    const tracks: ClipboardTrack[] = [
      { partOffset: 0, voiceIndex: 0, content: [makeNote("a", "C", 5)] },
      { partOffset: 1, voiceIndex: 0, content: [makeNote("b", "C", 3)] },
    ];
    const json = serializeFragment([makeNote("a", "C", 5)], defaultTime, defaultKey, tracks);
    const fragment = deserializeFragment(json);
    expect(fragment).not.toBeNull();
    expect(fragment!.tracks).toHaveLength(2);
    expect(fragment!.tracks![0]!.partOffset).toBe(0);
    expect(fragment!.tracks![1]!.partOffset).toBe(1);
  });

  it("handles empty tracks array gracefully", () => {
    const json = serializeFragment([makeNote("a", "C", 5)], defaultTime, defaultKey, []);
    const fragment = deserializeFragment(json);
    expect(fragment).not.toBeNull();
  });
});

// ═══════════════════════════════════════════
// eventSuffix function
// ═══════════════════════════════════════════

describe("eventSuffix", () => {
  it("returns model ID when present", () => {
    expect(eventSuffix("ev-abc", 0, 0, 0)).toBe("ev-abc");
  });

  it("generates __auto_ format when measureIndex and voiceIndex provided", () => {
    expect(eventSuffix(undefined, 3, 2, 1)).toBe("__auto_m2_v1_e3");
  });

  it("falls back to e{N} when only index provided", () => {
    expect(eventSuffix(undefined, 5)).toBe("e5");
  });

  it("sanitizes slashes in model IDs", () => {
    expect(eventSuffix("some/nested/id", 0)).toBe("some_nested_id");
  });
});

// ═══════════════════════════════════════════
// Mixed-ID scores (some events with IDs, some without)
// ═══════════════════════════════════════════

describe("mixed-ID scores", () => {
  it("handles scores where some events have IDs and others do not", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: defaultTime }] },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              sequences: [
                {
                  content: [
                    makeNote("ev-1", "C", 4), // has ID
                    makeAnonymousNote("D", 4), // no ID
                    makeNote("ev-3", "E", 4), // has ID
                    makeAnonymousNote("F", 4), // no ID
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const nav = buildNavigationIndex(score);
    const eventEntries = nav.entries.filter((e) => e.elementType === "event" || e.elementType === "rest");
    expect(eventEntries).toHaveLength(4);

    // Named events use their IDs
    expect(eventEntries[0]!.elementId).toBe("p0/m0/s0/ev-1");
    expect(eventEntries[2]!.elementId).toBe("p0/m0/s0/ev-3");

    // Anonymous events use __auto_ format
    expect(eventEntries[1]!.elementId).toContain("__auto_");
    expect(eventEntries[3]!.elementId).toContain("__auto_");

    // All should be resolvable
    for (const entry of eventEntries) {
      const loc = resolveEventLocation(entry.elementId, score);
      expect(loc).not.toBeNull();
    }
  });

  it("range selection across mixed IDs works", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: defaultTime }] },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              sequences: [
                {
                  content: [
                    makeNote("ev-1", "C", 4),
                    makeAnonymousNote("D", 4),
                    makeNote("ev-3", "E", 4),
                    makeAnonymousNote("F", 4),
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const nav = buildNavigationIndex(score);
    const entries = nav.entries.filter((e) => e.elementType === "event" || e.elementType === "rest");

    // Select from first to third event
    const ids = resolveRangeElementIds(entries[0]!.elementId, entries[2]!.elementId, score);
    expect(ids).toHaveLength(3);
    // Should include the anonymous event in between
    expect(ids).toContain(entries[0]!.elementId);
    expect(ids).toContain(entries[1]!.elementId);
    expect(ids).toContain(entries[2]!.elementId);
  });

  it("copy/paste from mixed-ID score works", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: defaultTime }, {}] },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              sequences: [
                {
                  content: [
                    makeNote("ev-1", "C", 4),
                    makeAnonymousNote("D", 4),
                    makeNote("ev-3", "E", 4),
                    makeAnonymousNote("F", 4),
                  ],
                },
              ],
            },
            {
              sequences: [{ content: [makeAnonymousNote("G", 4, "whole")] }],
            },
          ],
        },
      ],
    };

    const nav = buildNavigationIndex(score);
    const entries = nav.entries.filter(
      (e) => (e.elementType === "event" || e.elementType === "rest") && e.measureIndex === 0,
    );

    // Select first 2 events
    const ids = resolveRangeElementIds(entries[0]!.elementId, entries[1]!.elementId, score);
    const events = ids.map((id) => {
      const loc = resolveEventLocation(id, score)!;
      return score.parts[loc.partIndex]!.measures[loc.measureIndex]!.sequences[loc.sequenceIndex]!.content[
        loc.eventIndex
      ]!;
    });

    const paste = roundTrip(events);
    const result = applyPaste(score, paste, 0, 1, 0, 0);
    const m1 = result.parts[0]!.measures[1]!.sequences[0]!.content;
    expect(m1[0]!.notes![0]!.pitch.step).toBe("C");
    expect(m1[1]!.notes![0]!.pitch.step).toBe("D");
    expect(totalBeats(m1)).toBeCloseTo(4, 5);
  });
});

// ═══════════════════════════════════════════
// Paste into different time signatures
// ═══════════════════════════════════════════

describe("paste with different time signatures", () => {
  it("paste into 3/4 measure respects measure capacity", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 3, unit: 4 } }, {}] },
      parts: [
        {
          name: "Waltz",
          measures: [
            { sequences: [{ content: [makeNote("a", "C", 4), makeNote("b", "D", 4), makeNote("c", "E", 4)] }] },
            { sequences: [{ content: [makeNote("d", "F", 4), makeNote("e", "G", 4), makeNote("f", "A", 4)] }] },
          ],
        },
      ],
    };

    // Paste 4 quarter notes (4 beats) starting at beat 0 of 3/4 measure
    // 3 should fit in m0, 1 in m1
    const paste = makePaste([
      makeNote("x1", "B", 5),
      makeNote("x2", "C", 6),
      makeNote("x3", "D", 6),
      makeNote("x4", "E", 6),
    ]);
    const result = applyPaste(score, paste, 0, 0, 0, 0);
    const m0 = result.parts[0]!.measures[0]!.sequences[0]!.content;
    const m1 = result.parts[0]!.measures[1]!.sequences[0]!.content;
    expect(totalBeats(m0)).toBeCloseTo(3, 5);
    expect(totalBeats(m1)).toBeCloseTo(3, 5);
  });

  it("paste into 6/8 measure respects compound time", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 6, unit: 8 } }] },
      parts: [
        {
          name: "Jig",
          measures: [
            {
              sequences: [
                {
                  content: [
                    makeNote("a", "C", 4, "quarter"),
                    makeNote("b", "D", 4, "eighth"),
                    makeNote("c", "E", 4, "quarter"),
                    makeNote("d", "F", 4, "eighth"),
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    // 6/8 = 3 quarter-beats. Paste 2 quarters (2 beats) at beat 0
    const paste = makePaste([makeNote("x1", "A", 5), makeNote("x2", "B", 5)]);
    const result = applyPaste(score, paste, 0, 0, 0, 0);
    const m0 = result.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(totalBeats(m0)).toBeCloseTo(3, 5);
  });
});

// ═══════════════════════════════════════════
// Paste with rests
// ═══════════════════════════════════════════

describe("paste involving rests", () => {
  it("pasting a rest replaces notes with rests", () => {
    const score = makeIdScore();
    const paste = makePaste([makeRest("quarter")]);
    const result = applyPaste(score, paste, 0, 0, 0, 1);
    const m0 = result.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(isRest(m0[1]! as NoteEvent)).toBe(true);
    expect(totalBeats(m0)).toBeCloseTo(4, 5);
  });

  it("pasting notes over rests replaces rests with notes", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: defaultTime }] },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              sequences: [{ content: [makeRest("whole")] }],
            },
          ],
        },
      ],
    };

    const paste = makePaste([makeNote("x1", "C", 5), makeNote("x2", "D", 5)]);
    const result = applyPaste(score, paste, 0, 0, 0, 0);
    const m0 = result.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(m0[0]!.notes![0]!.pitch.step).toBe("C");
    expect(m0[1]!.notes![0]!.pitch.step).toBe("D");
    expect(totalBeats(m0)).toBeCloseTo(4, 5);
  });

  it("copying rests preserves them through round-trip", () => {
    const events: SequenceContent[] = [makeNote("a", "C", 4), makeRest("quarter"), makeNote("b", "E", 4)];
    const paste = roundTrip(events);

    expect(paste.content[0]!.notes![0]!.pitch.step).toBe("C");
    expect(isRest(paste.content[1]! as NoteEvent)).toBe(true);
    expect(paste.content[2]!.notes![0]!.pitch.step).toBe("E");
  });
});

// ═══════════════════════════════════════════
// Edge cases: empty / boundary conditions
// ═══════════════════════════════════════════

describe("boundary conditions", () => {
  it("applyPaste with empty content returns unchanged score", () => {
    const score = makeIdScore();
    const paste = makePaste([]);
    const result = applyPaste(score, paste, 0, 0, 0, 0);
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes![0]!.pitch.step).toBe("C");
  });

  it("applyPaste returns unchanged for out-of-range sequence index", () => {
    const score = makeIdScore();
    const paste = makePaste([makeNote("x", "A", 5)]);
    const result = applyPaste(score, paste, 0, 0, 99, 0);
    expect(result).toEqual(score);
  });

  it("applyCut with replacements beyond sequence length is safe", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: defaultTime }] },
      parts: [
        {
          name: "Piano",
          measures: [{ sequences: [{ content: [makeNote("a", "C", 4)] }] }],
        },
      ],
    };

    const cut: CutResult = {
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
      // 3 replacements for 1 event — should only replace the existing one
      replacements: [makeRest(), makeRest(), makeRest()],
    };
    const result = applyCut(score, cut);
    expect(isRest(result.parts[0]!.measures[0]!.sequences[0]!.content[0]! as NoteEvent)).toBe(true);
    // Should not crash or add extra events
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content).toHaveLength(1);
  });

  it("resolveRangeElementIds with identical start and end returns single element", () => {
    const score = makeIdScore();
    const ids = resolveRangeElementIds("p0/m0/s0/ev-b", "p0/m0/s0/ev-b", score);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe("p0/m0/s0/ev-b");
  });

  it("resolveEventLocation returns null for non-existent event ID", () => {
    const score = makeIdScore();
    expect(resolveEventLocation("p0/m0/s0/nonexistent", score)).toBeNull();
  });

  it("resolveEventLocation returns null for malformed IDs", () => {
    const score = makeIdScore();
    expect(resolveEventLocation("invalid", score)).toBeNull();
    expect(resolveEventLocation("p0/m0", score)).toBeNull();
    expect(resolveEventLocation("", score)).toBeNull();
  });
});
