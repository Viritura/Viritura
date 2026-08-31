import { describe, it, expect } from "vitest";
import type { SequenceContent, Score, TimeSignature, KeySignature } from "@viritura/core";
import { DURATION_BEATS } from "@viritura/core";
import { durationToBeats } from "../commands/noteCommands";
import { serializeFragment } from "../clipboard/serialize";
import { deserializeFragment, assignFreshIds } from "../clipboard/deserialize";
import { VIRITURA_FRAGMENT_TYPE, FRAGMENT_VERSION, type ClipboardFragment } from "../clipboard/ClipboardFragment";
import { applyPaste, applyCut, type CutResult, type PasteResult } from "../commands/clipboardCommands";

// ─── Test fixtures ───────────────────────────────────

const defaultTime: TimeSignature = { count: 4, unit: 4 };
const defaultKey: KeySignature = { fifths: 0 };

function makeNote(
  step: "C" | "D" | "E" | "F" | "G" | "A" | "B",
  octave: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
  base: "whole" | "half" | "quarter" | "eighth" = "quarter",
): SequenceContent {
  return {
    type: "event",
    id: `note-${step}${octave}`,
    duration: { base },
    notes: [
      {
        id: `pitch-${step}${octave}`,
        pitch: { step, octave },
      },
    ],
  };
}

function makeRest(base: "whole" | "half" | "quarter" | "eighth" = "quarter"): SequenceContent {
  return {
    type: "event",
    duration: { base },
    rest: {},
  };
}

function makeTestScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: defaultTime, key: defaultKey }, {}],
    },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [makeNote("C", 4), makeNote("D", 4), makeNote("E", 4), makeNote("F", 4)],
              },
            ],
          },
          {
            sequences: [
              {
                content: [makeRest("whole")],
              },
            ],
          },
        ],
      },
    ],
  };
}

// ─── Serialize tests ─────────────────────────────────

describe("serializeFragment", () => {
  it("serializes events into a valid fragment JSON", () => {
    const events: SequenceContent[] = [makeNote("C", 4), makeNote("D", 4)];
    const json = serializeFragment(events, defaultTime, defaultKey);
    const parsed = JSON.parse(json) as ClipboardFragment;

    expect(parsed.type).toBe(VIRITURA_FRAGMENT_TYPE);
    expect(parsed.version).toBe(FRAGMENT_VERSION);
    expect(parsed.timeSignature).toEqual(defaultTime);
    expect(parsed.keySignature).toEqual(defaultKey);
    expect(parsed.content).toHaveLength(2);
  });

  it("preserves internal IDs in serialized fragments", () => {
    const events: SequenceContent[] = [makeNote("C", 4)];
    const json = serializeFragment(events, defaultTime, defaultKey);
    const parsed = JSON.parse(json) as ClipboardFragment;

    expect(parsed.content[0]!.id).toBe("note-C4");
    expect(parsed.content[0]!.notes![0]!.id).toBe("pitch-C4");
  });

  it("preserves ties in serialized notes", () => {
    const event: SequenceContent = {
      type: "event",
      id: "tied-note",
      duration: { base: "quarter" },
      notes: [
        {
          id: "n1",
          pitch: { step: "C", octave: 4 },
          ties: [{ target: "n2" }],
        },
      ],
    };
    const json = serializeFragment([event], defaultTime, defaultKey);
    const parsed = JSON.parse(json) as ClipboardFragment;

    expect(parsed.content[0]!.notes![0]!.ties).toHaveLength(1);
    expect(parsed.content[0]!.notes![0]!.ties![0]!.target).toBe("n2");
  });

  it("preserves slurs in serialized events", () => {
    const event: SequenceContent = {
      type: "event",
      id: "slurred-note",
      duration: { base: "quarter" },
      notes: [{ pitch: { step: "E", octave: 5 } }],
      slurs: [{ target: "other-event" }],
    };
    const json = serializeFragment([event], defaultTime, defaultKey);
    const parsed = JSON.parse(json) as ClipboardFragment;

    expect(parsed.content[0]!.slurs).toHaveLength(1);
    expect(parsed.content[0]!.slurs![0]!.target).toBe("other-event");
  });

  it("serializes rests correctly", () => {
    const events: SequenceContent[] = [makeRest("half")];
    const json = serializeFragment(events, defaultTime, defaultKey);
    const parsed = JSON.parse(json) as ClipboardFragment;

    expect(parsed.content[0]!.rest).toEqual({});
    expect(parsed.content[0]!.duration.base).toBe("half");
  });

  it("preserves dotted durations", () => {
    const event: SequenceContent = {
      type: "event",
      duration: { base: "quarter", dots: 1 },
      notes: [{ pitch: { step: "G", octave: 4 } }],
    };
    const json = serializeFragment([event], defaultTime, defaultKey);
    const parsed = JSON.parse(json) as ClipboardFragment;

    expect(parsed.content[0]!.duration.dots).toBe(1);
  });

  it("handles empty content array", () => {
    const json = serializeFragment([], defaultTime, defaultKey);
    const parsed = JSON.parse(json) as ClipboardFragment;

    expect(parsed.content).toEqual([]);
  });
});

// ─── Deserialize tests ───────────────────────────────

describe("deserializeFragment", () => {
  it("deserializes a valid fragment JSON", () => {
    const events: SequenceContent[] = [makeNote("C", 4)];
    const json = serializeFragment(events, defaultTime, defaultKey);
    const result = deserializeFragment(json);

    expect(result).not.toBeNull();
    expect(result!.type).toBe(VIRITURA_FRAGMENT_TYPE);
    expect(result!.content).toHaveLength(1);
  });

  it("returns null for invalid JSON", () => {
    expect(deserializeFragment("not json")).toBeNull();
  });

  it("returns null for non-fragment JSON", () => {
    expect(deserializeFragment('{"hello": "world"}')).toBeNull();
  });

  it("returns null for wrong type field", () => {
    const bad = JSON.stringify({
      type: "other/format",
      version: 1,
      timeSignature: defaultTime,
      keySignature: defaultKey,
      content: [],
    });
    expect(deserializeFragment(bad)).toBeNull();
  });

  it("returns null for future version", () => {
    const bad = JSON.stringify({
      type: VIRITURA_FRAGMENT_TYPE,
      version: 999,
      timeSignature: defaultTime,
      keySignature: defaultKey,
      content: [],
    });
    expect(deserializeFragment(bad)).toBeNull();
  });

  it("returns null for missing timeSignature", () => {
    const bad = JSON.stringify({
      type: VIRITURA_FRAGMENT_TYPE,
      version: 1,
      keySignature: defaultKey,
      content: [],
    });
    expect(deserializeFragment(bad)).toBeNull();
  });

  it("returns null for missing keySignature", () => {
    const bad = JSON.stringify({
      type: VIRITURA_FRAGMENT_TYPE,
      version: 1,
      timeSignature: defaultTime,
      content: [],
    });
    expect(deserializeFragment(bad)).toBeNull();
  });

  it("returns null for invalid content items", () => {
    const bad = JSON.stringify({
      type: VIRITURA_FRAGMENT_TYPE,
      version: 1,
      timeSignature: defaultTime,
      keySignature: defaultKey,
      content: [{ type: "invalid" }],
    });
    expect(deserializeFragment(bad)).toBeNull();
  });

  it("returns null for content items missing duration", () => {
    const bad = JSON.stringify({
      type: VIRITURA_FRAGMENT_TYPE,
      version: 1,
      timeSignature: defaultTime,
      keySignature: defaultKey,
      content: [{ type: "event" }],
    });
    expect(deserializeFragment(bad)).toBeNull();
  });

  it("round-trips through serialize/deserialize", () => {
    const events: SequenceContent[] = [makeNote("C", 4), makeRest("eighth"), makeNote("G", 5, "half")];
    const json = serializeFragment(events, defaultTime, defaultKey);
    const result = deserializeFragment(json);

    expect(result).not.toBeNull();
    expect(result!.content).toHaveLength(3);
    expect(result!.content[0]!.duration.base).toBe("quarter");
    expect(result!.content[1]!.rest).toEqual({});
    expect(result!.content[2]!.notes![0]!.pitch.step).toBe("G");
    expect(result!.content[2]!.notes![0]!.pitch.octave).toBe(5);
  });
});

// ─── assignFreshIds tests ────────────────────────────

describe("assignFreshIds", () => {
  const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("assigns unique IDs to events", () => {
    const events: SequenceContent[] = [makeNote("C", 4), makeNote("D", 4)];
    // Clear IDs first (like after serialization)
    for (const e of events) {
      delete e.id;
    }

    const result = assignFreshIds(events);
    expect(result[0]!.id).toBeDefined();
    expect(result[1]!.id).toBeDefined();
    expect(result[0]!.id).not.toBe(result[1]!.id);
    expect(result[0]!.id).toMatch(uuidV7);
    expect(result[1]!.id).toMatch(uuidV7);
  });

  it("assigns unique IDs to notes within events", () => {
    const event: SequenceContent = {
      type: "event",
      duration: { base: "quarter" },
      notes: [{ pitch: { step: "C", octave: 4 } }, { pitch: { step: "E", octave: 4 } }],
    };

    const result = assignFreshIds([event]);
    expect(result[0]!.notes![0]!.id).toBeDefined();
    expect(result[0]!.notes![1]!.id).toBeDefined();
    expect(result[0]!.notes![0]!.id).not.toBe(result[0]!.notes![1]!.id);
    expect(result[0]!.notes![0]!.id).toMatch(uuidV7);
    expect(result[0]!.notes![1]!.id).toMatch(uuidV7);
  });

  it("does not mutate the input", () => {
    const events: SequenceContent[] = [makeNote("C", 4)];
    const originalId = events[0]!.id;
    assignFreshIds(events);
    expect(events[0]!.id).toBe(originalId);
  });

  it("handles rests (no notes)", () => {
    const events: SequenceContent[] = [makeRest()];
    const result = assignFreshIds(events);
    expect(result[0]!.id).toBeDefined();
  });

  it("remaps slur targets to new event IDs", () => {
    const events: SequenceContent[] = [
      {
        type: "event",
        id: "ev-src",
        duration: { base: "quarter" },
        notes: [{ id: "n1", pitch: { step: "C", octave: 4 } }],
        slurs: [{ target: "ev-tgt" }],
      },
      {
        type: "event",
        id: "ev-tgt",
        duration: { base: "quarter" },
        notes: [{ id: "n2", pitch: { step: "E", octave: 4 } }],
      },
    ];
    const result = assignFreshIds(events);
    // Slur target should point to the new ID of ev-tgt
    expect(result[0]!.slurs).toHaveLength(1);
    expect(result[0]!.slurs![0]!.target).toBe(result[1]!.id);
    expect(result[0]!.slurs![0]!.target).not.toBe("ev-tgt");
  });

  it("removes slurs whose target is outside the fragment", () => {
    const events: SequenceContent[] = [
      {
        type: "event",
        id: "ev-src",
        duration: { base: "quarter" },
        notes: [{ pitch: { step: "C", octave: 4 } }],
        slurs: [{ target: "ev-outside" }],
      },
    ];
    const result = assignFreshIds(events);
    // "ev-outside" is not in the fragment, so the slur should be removed
    expect(result[0]!.slurs).toBeUndefined();
  });

  it("remaps tie targets to new note IDs", () => {
    const events: SequenceContent[] = [
      {
        type: "event",
        id: "ev1",
        duration: { base: "quarter" },
        notes: [
          {
            id: "n1",
            pitch: { step: "C", octave: 4 },
            ties: [{ target: "n2" }],
          },
        ],
      },
      {
        type: "event",
        id: "ev2",
        duration: { base: "quarter" },
        notes: [
          {
            id: "n2",
            pitch: { step: "C", octave: 4 },
          },
        ],
      },
    ];
    const result = assignFreshIds(events);
    const tie = result[0]!.notes![0]!.ties![0]!;
    expect(tie.target).toBe(result[1]!.notes![0]!.id);
    expect(tie.target).not.toBe("n2");
  });

  it("removes ties whose target note is outside the fragment", () => {
    const events: SequenceContent[] = [
      {
        type: "event",
        id: "ev1",
        duration: { base: "quarter" },
        notes: [
          {
            id: "n1",
            pitch: { step: "C", octave: 4 },
            ties: [{ target: "n-outside" }],
          },
        ],
      },
    ];
    const result = assignFreshIds(events);
    expect(result[0]!.notes![0]!.ties).toBeUndefined();
  });
});

// ─── Grace note clipboard tests ──────────────────────

describe("grace note clipboard round-trip", () => {
  const graceFragment: import("../clipboard/ClipboardFragment").ClipboardFragment = {
    type: "viritura/fragment",
    version: 2,
    timeSignature: defaultTime,
    keySignature: defaultKey,
    content: [
      {
        type: "grace",
        content: [
          {
            type: "event",
            id: "grace-ev-1",
            duration: { base: "eighth" },
            notes: [{ id: "grace-n-1", pitch: { step: "B", octave: 4 } }],
          },
        ],
        slash: true,
      } as import("@viritura/core").Grace,
      {
        type: "event",
        id: "main-ev-1",
        duration: { base: "quarter" },
        notes: [{ id: "main-n-1", pitch: { step: "C", octave: 5 } }],
      },
    ],
  };

  it("deserializes a fragment containing a grace container", () => {
    const json = JSON.stringify(graceFragment);
    const result = deserializeFragment(json);
    expect(result).not.toBeNull();
    expect(result!.content).toHaveLength(2);
    expect(result!.content[0]!.type).toBe("grace");
    expect(result!.content[1]!.type).toBe("event");
  });

  it("assignFreshIds assigns new IDs inside grace containers", () => {
    const result = assignFreshIds(graceFragment.content);
    expect(result[0]!.type).toBe("grace");
    const grace = result[0] as import("@viritura/core").Grace;
    expect(grace.content[0]!.id).toBeDefined();
    expect(grace.content[0]!.id).not.toBe("grace-ev-1");
    expect(grace.content[0]!.notes![0]!.id).not.toBe("grace-n-1");
  });

  it("does not mutate the original grace container on assignFreshIds", () => {
    const original = graceFragment.content;
    assignFreshIds(original);
    const grace = original[0] as import("@viritura/core").Grace;
    expect(grace.content[0]!.id).toBe("grace-ev-1");
  });

  it("each assignFreshIds call produces distinct IDs for grace events", () => {
    const first = assignFreshIds(graceFragment.content);
    const second = assignFreshIds(graceFragment.content);
    const firstId = (first[0] as import("@viritura/core").Grace).content[0]!.id;
    const secondId = (second[0] as import("@viritura/core").Grace).content[0]!.id;
    expect(firstId).not.toBe(secondId);
  });

  it("serialize → deserialize round-trip preserves grace container", () => {
    const json = serializeFragment(graceFragment.content, defaultTime, defaultKey);
    const parsed = deserializeFragment(json);
    expect(parsed).not.toBeNull();
    expect(parsed!.content[0]!.type).toBe("grace");
    const grace = parsed!.content[0] as import("@viritura/core").Grace;
    expect(grace.slash).toBe(true);
    expect(grace.content[0]!.notes![0]!.pitch.step).toBe("B");
  });

  it("applyPaste inserts grace container without error", () => {
    const score = makeTestScore();
    const result = applyPaste(
      score,
      { content: graceFragment.content, sourceTimeSignature: defaultTime, sourceKeySignature: defaultKey },
      0,
      0,
      0,
      0,
    );
    const seq = result.parts[0]!.measures[0]!.sequences[0]!.content;
    const graceItem = seq.find((ev) => ev.type === "grace");
    expect(graceItem).toBeDefined();
  });
});

// ─── applyPaste tests ───────────────────────────────

describe("applyPaste", () => {
  it("replaces events at the target position", () => {
    const score = makeTestScore();
    const paste: PasteResult = {
      content: [makeNote("A", 5), makeNote("B", 5)],
      sourceTimeSignature: defaultTime,
      sourceKeySignature: defaultKey,
    };

    const result = applyPaste(score, paste, 0, 0, 0, 1);

    // Events at index 1 and 2 should be replaced
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes![0]!.pitch.step).toBe("C");
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content[1]!.notes![0]!.pitch.step).toBe("A");
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content[2]!.notes![0]!.pitch.step).toBe("B");
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content[3]!.notes![0]!.pitch.step).toBe("F");
  });

  it("does not mutate the original score", () => {
    const score = makeTestScore();
    const paste: PasteResult = {
      content: [makeNote("A", 5)],
      sourceTimeSignature: defaultTime,
      sourceKeySignature: defaultKey,
    };

    applyPaste(score, paste, 0, 0, 0, 0);

    expect(score.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes![0]!.pitch.step).toBe("C");
  });

  it("handles paste at end of sequence (partial replace)", () => {
    const score = makeTestScore();
    const paste: PasteResult = {
      content: [makeNote("A", 5), makeNote("B", 5), makeNote("C", 6)],
      sourceTimeSignature: defaultTime,
      sourceKeySignature: defaultKey,
    };

    // Paste 3 events starting at index 3 (only 1 slot left)
    const result = applyPaste(score, paste, 0, 0, 0, 3);
    const content = result.parts[0]!.measures[0]!.sequences[0]!.content;

    // Should replace the last event and append the rest
    expect(content.length).toBeGreaterThanOrEqual(4);
    expect(content[3]!.notes![0]!.pitch.step).toBe("A");
  });

  it("returns unchanged score for invalid part index", () => {
    const score = makeTestScore();
    const paste: PasteResult = {
      content: [makeNote("A", 5)],
      sourceTimeSignature: defaultTime,
      sourceKeySignature: defaultKey,
    };

    const result = applyPaste(score, paste, 99, 0, 0, 0);
    expect(result).toEqual(score);
  });

  it("returns unchanged score for invalid measure index", () => {
    const score = makeTestScore();
    const paste: PasteResult = {
      content: [makeNote("A", 5)],
      sourceTimeSignature: defaultTime,
      sourceKeySignature: defaultKey,
    };

    const result = applyPaste(score, paste, 0, 99, 0, 0);
    expect(result).toEqual(score);
  });
});

// ─── applyCut tests ──────────────────────────────────

describe("applyCut", () => {
  it("replaces cut events with rests", () => {
    const score = makeTestScore();
    const cut: CutResult = {
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 1,
      replacements: [makeRest("quarter"), makeRest("quarter")],
    };

    const result = applyCut(score, cut);
    const content = result.parts[0]!.measures[0]!.sequences[0]!.content;

    // Original note at index 0 preserved
    expect(content[0]!.notes![0]!.pitch.step).toBe("C");
    // Index 1 and 2 replaced with rests
    expect(content[1]!.rest).toEqual({});
    expect(content[2]!.rest).toEqual({});
    // Index 3 preserved
    expect(content[3]!.notes![0]!.pitch.step).toBe("F");
  });

  it("does not mutate the original score", () => {
    const score = makeTestScore();
    const cut: CutResult = {
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
      replacements: [makeRest("quarter")],
    };

    applyCut(score, cut);
    expect(score.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes![0]!.pitch.step).toBe("C");
  });

  it("preserves durations when replacing with rests", () => {
    const score = makeTestScore();
    // Replace half note with half rest
    const cut: CutResult = {
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
      replacements: [{ type: "event", duration: { base: "quarter" }, rest: {} }],
    };

    const result = applyCut(score, cut);
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content[0]!.duration.base).toBe("quarter");
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content[0]!.rest).toEqual({});
  });

  it("returns unchanged score for invalid indices", () => {
    const score = makeTestScore();
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

// ─── Full round-trip: serialize → deserialize → paste ─

describe("clipboard round-trip", () => {
  it("copy then paste preserves pitch and duration", () => {
    const score = makeTestScore();
    const events = score.parts[0]!.measures[0]!.sequences[0]!.content.slice(0, 2);

    // Serialize (copy)
    const json = serializeFragment(events, defaultTime, defaultKey);

    // Deserialize (paste read)
    const fragment = deserializeFragment(json);
    expect(fragment).not.toBeNull();

    // Assign fresh IDs
    const freshContent = assignFreshIds(fragment!.content);

    // Apply paste to measure 2
    const paste: PasteResult = {
      content: freshContent,
      sourceTimeSignature: fragment!.timeSignature,
      sourceKeySignature: fragment!.keySignature,
    };

    const result = applyPaste(score, paste, 0, 1, 0, 0);
    const pasted = result.parts[0]!.measures[1]!.sequences[0]!.content;

    // Pasted events have same pitch as originals
    expect(pasted[0]!.notes![0]!.pitch.step).toBe("C");
    expect(pasted[0]!.notes![0]!.pitch.octave).toBe(4);
    expect(pasted[0]!.duration.base).toBe("quarter");

    // But different IDs
    expect(pasted[0]!.id).toBeDefined();
    expect(pasted[0]!.id).not.toBe(events[0]!.id);
  });
});

// ═══════════════════════════════════════════
// Duration-aware paste (regression tests)
// ═══════════════════════════════════════════

describe("applyPaste — duration-aware replacement", () => {
  const defaultPaste = (content: SequenceContent[]): PasteResult => ({
    content,
    sourceTimeSignature: defaultTime,
    sourceKeySignature: defaultKey,
  });

  it("replaces events by duration, not by count (paste 2 quarters over 1 half)", () => {
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
                  content: [makeNote("C", 4, "half"), makeNote("E", 4, "half")],
                },
              ],
            },
          ],
        },
      ],
    };

    const paste = defaultPaste([makeNote("G", 4, "quarter"), makeNote("A", 4, "quarter")]);

    const result = applyPaste(score, paste, 0, 0, 0, 0);
    const content = result.parts[0]!.measures[0]!.sequences[0]!.content;

    // Should have: G4 quarter, A4 quarter, E4 half = 4 beats total (correct 4/4)
    const totalBeats = content.reduce(
      (sum: number, ev: SequenceContent) =>
        sum + (ev.duration ? ((DURATION_BEATS as Record<string, number>)[ev.duration.base] ?? 0) : 0),
      0,
    );
    expect(totalBeats).toBeCloseTo(4, 5);

    // First two events should be the pasted notes
    expect(content[0]!.notes?.[0]?.pitch.step).toBe("G");
    expect(content[1]!.notes?.[0]?.pitch.step).toBe("A");

    // E4 half should still be there
    expect(content[content.length - 1]!.notes?.[0]?.pitch.step).toBe("E");
  });

  it("fills leftover time with rests when pasting shorter content over longer event", () => {
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
                  content: [makeNote("C", 4, "whole")],
                },
              ],
            },
          ],
        },
      ],
    };

    // Paste 1 quarter over a whole note — should leave 3 beats of rest
    const paste = defaultPaste([makeNote("D", 4, "quarter")]);

    const result = applyPaste(score, paste, 0, 0, 0, 0);
    const content = result.parts[0]!.measures[0]!.sequences[0]!.content;

    // First event should be D4 quarter
    expect(content[0]!.notes?.[0]?.pitch.step).toBe("D");
    expect(content[0]!.duration.base).toBe("quarter");

    // Total should still be 4 beats
    const totalBeats = content.reduce(
      (sum: number, ev: SequenceContent) => sum + (ev.duration ? durationToBeats(ev.duration) : 0),
      0,
    );
    expect(totalBeats).toBeCloseTo(4, 5);
  });

  it("replaces multiple events to match paste duration", () => {
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
                    makeNote("C", 4, "quarter"),
                    makeNote("D", 4, "quarter"),
                    makeNote("E", 4, "quarter"),
                    makeNote("F", 4, "quarter"),
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    // Paste 1 half note over first event — should consume 2 quarter notes
    const paste = defaultPaste([makeNote("G", 4, "half")]);

    const result = applyPaste(score, paste, 0, 0, 0, 0);
    const content = result.parts[0]!.measures[0]!.sequences[0]!.content;

    // Should be: G4 half, E4 quarter, F4 quarter = 4 beats
    expect(content[0]!.notes?.[0]?.pitch.step).toBe("G");
    expect(content[0]!.duration.base).toBe("half");
    expect(content[1]!.notes?.[0]?.pitch.step).toBe("E");
    expect(content[2]!.notes?.[0]?.pitch.step).toBe("F");
    expect(content.length).toBe(3);
  });

  it("does not cause bar overflow", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              sequences: [
                {
                  content: [makeNote("C", 4, "half"), makeNote("D", 4, "half")],
                },
              ],
            },
          ],
        },
      ],
    };

    // Paste 4 quarter notes (4 beats) starting at first event (2 beats)
    // Should consume both half notes (4 beats total) and replace with the 4 quarters
    const paste = defaultPaste([
      makeNote("A", 4, "quarter"),
      makeNote("B", 4, "quarter"),
      makeNote("C", 5, "quarter"),
      makeNote("D", 5, "quarter"),
    ]);

    const result = applyPaste(score, paste, 0, 0, 0, 0);
    const content = result.parts[0]!.measures[0]!.sequences[0]!.content;

    const totalBeats = content.reduce(
      (sum: number, ev: SequenceContent) =>
        sum + (ev.duration ? ((DURATION_BEATS as Record<string, number>)[ev.duration.base] ?? 0) : 0),
      0,
    );
    expect(totalBeats).toBeCloseTo(4, 5);
    expect(content.length).toBe(4);
  });

  it("distributes multi-measure paste across measures correctly", () => {
    // Score: 3 measures of 4/4, each with a whole note
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }, {}, {}] },
      parts: [
        {
          name: "Piano",
          measures: [
            { sequences: [{ content: [makeNote("C", 4, "whole")] }] },
            { sequences: [{ content: [makeNote("D", 4, "whole")] }] },
            { sequences: [{ content: [makeNote("E", 4, "whole")] }] },
          ],
        },
      ],
    };

    // Paste 8 quarter notes (= 2 measures worth of content) starting at measure 0
    const paste = defaultPaste([
      makeNote("A", 5, "quarter"),
      makeNote("B", 5, "quarter"),
      makeNote("C", 5, "quarter"),
      makeNote("D", 5, "quarter"),
      makeNote("E", 5, "quarter"),
      makeNote("F", 5, "quarter"),
      makeNote("G", 5, "quarter"),
      makeNote("A", 4, "quarter"),
    ]);

    const result = applyPaste(score, paste, 0, 0, 0, 0);

    // Measure 0: should have 4 quarter notes (4 beats)
    const m0 = result.parts[0]!.measures[0]!.sequences[0]!.content;
    const m0Beats = m0.reduce(
      (sum: number, ev: SequenceContent) =>
        sum + (ev.duration ? ((DURATION_BEATS as Record<string, number>)[ev.duration.base] ?? 0) : 0),
      0,
    );
    expect(m0Beats).toBeCloseTo(4, 5);
    expect(m0[0]!.notes?.[0]?.pitch.step).toBe("A");

    // Measure 1: should have 4 quarter notes (4 beats)
    const m1 = result.parts[0]!.measures[1]!.sequences[0]!.content;
    const m1Beats = m1.reduce(
      (sum: number, ev: SequenceContent) =>
        sum + (ev.duration ? ((DURATION_BEATS as Record<string, number>)[ev.duration.base] ?? 0) : 0),
      0,
    );
    expect(m1Beats).toBeCloseTo(4, 5);
    expect(m1[0]!.notes?.[0]?.pitch.step).toBe("E");

    // Measure 2: should be unchanged (E4 whole)
    const m2 = result.parts[0]!.measures[2]!.sequences[0]!.content;
    expect(m2[0]!.notes?.[0]?.pitch.step).toBe("E");
    expect(m2[0]!.duration.base).toBe("whole");
  });

  it("handles paste starting mid-measure and flowing into next", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }, {}] },
      parts: [
        {
          name: "Piano",
          measures: [
            { sequences: [{ content: [makeNote("C", 4, "half"), makeNote("D", 4, "half")] }] },
            { sequences: [{ content: [makeNote("E", 4, "whole")] }] },
          ],
        },
      ],
    };

    // Paste 4 quarter notes starting at event index 1 (beat 2 of measure 0)
    // Should fill beats 2-4 of measure 0, then beat 1 of measure 1
    const paste = defaultPaste([
      makeNote("A", 5, "quarter"),
      makeNote("B", 5, "quarter"),
      makeNote("C", 5, "quarter"),
      makeNote("D", 5, "quarter"),
    ]);

    const result = applyPaste(score, paste, 0, 0, 0, 1);

    // Measure 0: C4 half (beat 0-2) + A5 quarter + B5 quarter = 4 beats
    const m0 = result.parts[0]!.measures[0]!.sequences[0]!.content;
    const m0Beats = m0.reduce(
      (sum: number, ev: SequenceContent) =>
        sum + (ev.duration ? ((DURATION_BEATS as Record<string, number>)[ev.duration.base] ?? 0) : 0),
      0,
    );
    expect(m0Beats).toBeCloseTo(4, 5);

    // Measure 1: should contain the overflow content + remaining E4
    const m1 = result.parts[0]!.measures[1]!.sequences[0]!.content;
    const m1Beats = m1.reduce(
      (sum: number, ev: SequenceContent) =>
        sum + (ev.duration ? ((DURATION_BEATS as Record<string, number>)[ev.duration.base] ?? 0) : 0),
      0,
    );
    expect(m1Beats).toBeCloseTo(4, 5);
  });

  it("does not leak clearing past fullMeasure blank measures", () => {
    // Measure 0 has real notes, Measure 1 is blank (fullMeasure), Measure 2 has real notes
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }, {}, {}] },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              sequences: [
                {
                  content: [
                    makeNote("C", 4, "quarter"),
                    makeNote("D", 4, "quarter"),
                    makeNote("E", 4, "quarter"),
                    makeNote("F", 4, "quarter"),
                  ],
                },
              ],
            },
            { sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }] },
            { sequences: [{ content: [makeNote("G", 4, "whole")] }] },
          ],
        },
      ],
    };

    // Paste 4 quarter notes at event 2 of measure 0 (beat 2).
    // Content should flow into measure 1, NOT touch measure 2.
    const paste = defaultPaste([
      makeNote("A", 5, "quarter"),
      makeNote("B", 5, "quarter"),
      makeNote("C", 5, "quarter"),
      makeNote("D", 5, "quarter"),
    ]);

    const result = applyPaste(score, paste, 0, 0, 0, 2);

    // Measure 0: C4 D4 + 2 pasted = 4 beats
    const m0 = result.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(m0).toHaveLength(4);
    expect(m0[0]!.notes?.[0]?.pitch.step).toBe("C");
    expect(m0[1]!.notes?.[0]?.pitch.step).toBe("D");
    expect(m0[2]!.notes?.[0]?.pitch.step).toBe("A");
    expect(m0[3]!.notes?.[0]?.pitch.step).toBe("B");

    // Measure 1: 2 pasted quarter notes (fullMeasure cleared)
    const m1 = result.parts[0]!.measures[1]!.sequences[0]!.content;
    expect(m1[0]!.notes?.[0]?.pitch.step).toBe("C");
    expect(m1[1]!.notes?.[0]?.pitch.step).toBe("D");

    // Measure 2: MUST be untouched — G4 whole note preserved
    const m2 = result.parts[0]!.measures[2]!.sequences[0]!.content;
    expect(m2).toHaveLength(1);
    expect(m2[0]!.notes?.[0]?.pitch.step).toBe("G");
    expect(m2[0]!.duration.base).toBe("whole");
  });

  it("auto-appends measures when paste overflows past end of score", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Piano",
          measures: [{ sequences: [{ content: [makeNote("C", 4, "whole")] }] }],
        },
      ],
    };

    // Paste 8 quarter notes into a 1-measure score
    const paste = defaultPaste([
      makeNote("A", 5, "quarter"),
      makeNote("B", 5, "quarter"),
      makeNote("C", 5, "quarter"),
      makeNote("D", 5, "quarter"),
      makeNote("E", 5, "quarter"),
      makeNote("F", 5, "quarter"),
      makeNote("G", 5, "quarter"),
      makeNote("A", 4, "quarter"),
    ]);

    const result = applyPaste(score, paste, 0, 0, 0, 0);

    // Should now have 2 measures
    expect(result.parts[0]!.measures).toHaveLength(2);
    expect(result.global.measures).toHaveLength(2);

    const m0 = result.parts[0]!.measures[0]!.sequences[0]!.content;
    const m0Beats = m0.reduce(
      (sum: number, ev: SequenceContent) =>
        sum + (ev.duration ? ((DURATION_BEATS as Record<string, number>)[ev.duration.base] ?? 0) : 0),
      0,
    );
    expect(m0Beats).toBeCloseTo(4, 5);

    const m1 = result.parts[0]!.measures[1]!.sequences[0]!.content;
    const m1Beats = m1.reduce(
      (sum: number, ev: SequenceContent) =>
        sum + (ev.duration ? ((DURATION_BEATS as Record<string, number>)[ev.duration.base] ?? 0) : 0),
      0,
    );
    expect(m1Beats).toBeCloseTo(4, 5);
  });
});

// ═══════════════════════════════════════════
// Multi-track (cross-staff) paste
// ═══════════════════════════════════════════

describe("applyPaste — multi-track (cross-staff)", () => {
  const defaultPaste = (
    content: SequenceContent[],
    tracks?: { partOffset: number; voiceIndex: number; content: SequenceContent[] }[],
  ): PasteResult => ({
    content,
    sourceTimeSignature: defaultTime,
    sourceKeySignature: defaultKey,
    tracks,
  });

  /** 2-part score: Violin + Cello, each with whole notes. */
  function makeTwoPartScore(): Score {
    return {
      mnx: { version: 1 },
      global: { measures: [{ time: defaultTime }, {}] },
      parts: [
        {
          name: "Violin",
          measures: [
            { sequences: [{ content: [makeNote("C", 5, "whole")] }] },
            { sequences: [{ content: [makeNote("D", 5, "whole")] }] },
          ],
        },
        {
          name: "Cello",
          measures: [
            { sequences: [{ content: [makeNote("C", 3, "whole")] }] },
            { sequences: [{ content: [makeNote("D", 3, "whole")] }] },
          ],
        },
      ],
    };
  }

  it("pastes multi-track content into corresponding parts", () => {
    const score = makeTwoPartScore();

    const paste = defaultPaste(
      [makeNote("A", 5, "whole")], // primary (backward compat)
      [
        { partOffset: 0, voiceIndex: 0, content: [makeNote("A", 5, "whole")] },
        { partOffset: 1, voiceIndex: 0, content: [makeNote("A", 3, "whole")] },
      ],
    );

    const result = applyPaste(score, paste, 0, 0, 0, 0);

    // Part 0: should have A5
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes?.[0]?.pitch.step).toBe("A");
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes?.[0]?.pitch.octave).toBe(5);

    // Part 1: should have A3
    expect(result.parts[1]!.measures[0]!.sequences[0]!.content[0]!.notes?.[0]?.pitch.step).toBe("A");
    expect(result.parts[1]!.measures[0]!.sequences[0]!.content[0]!.notes?.[0]?.pitch.octave).toBe(3);

    // Measure 1 in both parts should be unchanged
    expect(result.parts[0]!.measures[1]!.sequences[0]!.content[0]!.notes?.[0]?.pitch.step).toBe("D");
    expect(result.parts[1]!.measures[1]!.sequences[0]!.content[0]!.notes?.[0]?.pitch.step).toBe("D");
  });

  it("handles grand staff (multiple voices in one part)", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: defaultTime }] },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              sequences: [
                { content: [makeNote("C", 5, "whole")] }, // voice 0 (treble)
                { content: [makeNote("C", 3, "whole")] }, // voice 1 (bass)
              ],
            },
          ],
        },
      ],
    };

    // Paste into both voices of the same part
    const paste = defaultPaste(
      [makeNote("E", 5, "whole")],
      [
        { partOffset: 0, voiceIndex: 0, content: [makeNote("E", 5, "whole")] },
        { partOffset: 0, voiceIndex: 1, content: [makeNote("E", 3, "whole")] },
      ],
    );

    const result = applyPaste(score, paste, 0, 0, 0, 0);

    // Voice 0: E5
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes?.[0]?.pitch.step).toBe("E");
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes?.[0]?.pitch.octave).toBe(5);

    // Voice 1: E3
    expect(result.parts[0]!.measures[0]!.sequences[1]!.content[0]!.notes?.[0]?.pitch.step).toBe("E");
    expect(result.parts[0]!.measures[0]!.sequences[1]!.content[0]!.notes?.[0]?.pitch.octave).toBe(3);
  });

  it("skips tracks that target non-existent parts", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: defaultTime }] },
      parts: [
        {
          name: "Solo",
          measures: [{ sequences: [{ content: [makeNote("C", 4, "whole")] }] }],
        },
      ],
    };

    // Track targets partOffset=1, but there's only 1 part
    const paste = defaultPaste(
      [makeNote("G", 4, "whole")],
      [
        { partOffset: 0, voiceIndex: 0, content: [makeNote("G", 4, "whole")] },
        { partOffset: 1, voiceIndex: 0, content: [makeNote("G", 3, "whole")] },
      ],
    );

    const result = applyPaste(score, paste, 0, 0, 0, 0);

    // Part 0 should be updated
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes?.[0]?.pitch.step).toBe("G");
    // No crash, score still has 1 part
    expect(result.parts.length).toBe(1);
  });

  it("maintains measure beat integrity across all pasted tracks", () => {
    const score = makeTwoPartScore();

    // Paste 2 quarters into each part (replacing whole notes)
    const paste = defaultPaste(
      [makeNote("A", 5, "quarter"), makeNote("B", 5, "quarter")],
      [
        { partOffset: 0, voiceIndex: 0, content: [makeNote("A", 5, "quarter"), makeNote("B", 5, "quarter")] },
        { partOffset: 1, voiceIndex: 0, content: [makeNote("A", 3, "quarter"), makeNote("B", 3, "quarter")] },
      ],
    );

    const result = applyPaste(score, paste, 0, 0, 0, 0);

    // Both parts measure 0 should have 4 beats total
    for (let p = 0; p < 2; p++) {
      const content = result.parts[p]!.measures[0]!.sequences[0]!.content;
      const beats = content.reduce(
        (sum: number, ev: SequenceContent) =>
          sum + (ev.duration ? ((DURATION_BEATS as Record<string, number>)[ev.duration.base] ?? 0) : 0),
        0,
      );
      expect(beats).toBeCloseTo(4, 5);
    }
  });

  it("falls back to single-track paste when no tracks provided", () => {
    const score = makeTwoPartScore();

    const paste = defaultPaste([makeNote("F", 5, "whole")]);
    const result = applyPaste(score, paste, 0, 0, 0, 0);

    // Part 0 updated
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes?.[0]?.pitch.step).toBe("F");
    // Part 1 unchanged
    expect(result.parts[1]!.measures[0]!.sequences[0]!.content[0]!.notes?.[0]?.pitch.step).toBe("C");
  });
});

describe("applyPaste - dynamics carry-over", () => {
  it("copies a dynamic positioned within the selection into the paste target", () => {
    const score = makeTestScore();
    score.parts[0]!.measures[0]!.dynamics = [{ position: { fraction: [1, 4] }, value: "mf" }];

    const paste: PasteResult = {
      content: assignFreshIds([makeNote("C", 4), makeNote("D", 4), makeNote("E", 4), makeNote("F", 4)]),
      sourceTimeSignature: defaultTime,
      sourceKeySignature: defaultKey,
      dynamics: [{ measureOffset: 0, dynamic: { position: { fraction: [1, 4] }, value: "mf" } }],
    };

    const result = applyPaste(score, paste, 0, 1, 0, 0);

    const m1Dyns = result.parts[0]!.measures[1]!.dynamics;
    expect(m1Dyns).toBeDefined();
    expect(m1Dyns).toHaveLength(1);
    expect(m1Dyns![0]!.value).toBe("mf");
    const frac = m1Dyns![0]!.position.fraction;
    expect(frac[0] / frac[1]).toBeCloseTo(1 / 4, 5);
  });
});
