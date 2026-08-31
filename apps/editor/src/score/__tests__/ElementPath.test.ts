import { describe, it, expect } from "vitest";
import type { Score, NoteEvent } from "@viritura/core";
import type { Step, Octave } from "@viritura/core";
import {
  // ID construction
  eventSuffix,
  eventId,
  graceId,
  noteheadId,
  articulationId,
  tremoloId,
  fermataId,
  clefId,
  keySigId,
  dynamicId,
  hairpinId,
  pedalId,
  ottavaId,
  expressionId,
  chordSymbolId,
  timeSigId,
  barlineId,
  tempoId,
  segnoId,
  codaId,
  fineId,
  jumpId,
  rehearsalId,
  voltaId,
  measureNumberId,
  // Parsing
  extractPartIndex,
  extractMeasureIndex,
  extractSequenceIndex,
  extractNoteIndex,
  getEventAncestorId,
  resolveEventLocation,
  resolveEventFromSubElement,
  resolveAnnotationLocation,
  getEventAtLocation,
} from "../ElementPath";

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

function makeNote(id: string, base: "whole" | "half" | "quarter", step: Step = "C", octave: Octave = 4): NoteEvent {
  return { type: "event", id, duration: { base }, notes: [{ pitch: { step, octave } }] };
}

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }, {}] },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [{ content: [makeNote("ev1", "quarter"), makeNote("ev2", "quarter"), makeNote("ev3", "half")] }],
          },
          { sequences: [{ content: [makeNote("m1-ev1", "whole")] }] },
        ],
      },
    ],
  };
}

// ═══════════════════════════════════════════
// ID Construction
// ═══════════════════════════════════════════

describe("ID construction", () => {
  it("eventSuffix uses MNX id when present", () => {
    expect(eventSuffix("my-note", 0)).toBe("my-note");
  });

  it("eventSuffix falls back to index", () => {
    expect(eventSuffix(undefined, 3)).toBe("e3");
  });

  it("eventSuffix generates auto ID matching Rust engine when measure/voice provided", () => {
    expect(eventSuffix(undefined, 0, 6, 0)).toBe("__auto_m6_v0_e0");
    expect(eventSuffix(undefined, 2, 3, 1)).toBe("__auto_m3_v1_e2");
  });

  it("eventSuffix sanitizes slashes in vendor IDs", () => {
    expect(eventSuffix("voice/1/note/3", 0)).toBe("voice_1_note_3");
  });

  it("eventId builds full path", () => {
    expect(eventId(0, 1, 0, "ev1")).toBe("p0/m1/s0/ev1");
  });

  it("graceId includes grace segment", () => {
    expect(graceId(0, 0, 0, "e0", "g1")).toBe("p0/m0/s0/e0/grace/g1");
  });

  it("noteheadId appends /n{index}", () => {
    expect(noteheadId("p0/m0/s0/ev1", 2)).toBe("p0/m0/s0/ev1/n2");
  });

  it("articulationId appends /art-{name}", () => {
    expect(articulationId("p0/m0/s0/ev1", "accent")).toBe("p0/m0/s0/ev1/art-accent");
    expect(articulationId("p0/m0/s0/ev1", "accent.staccato")).toBe("p0/m0/s0/ev1/art-accent.staccato");
  });

  it("tremoloId appends /trem", () => {
    expect(tremoloId("p0/m0/s0/ev1")).toBe("p0/m0/s0/ev1/trem");
  });

  it("fermataId appends /ferm", () => {
    expect(fermataId("p0/m0/s0/ev1")).toBe("p0/m0/s0/ev1/ferm");
  });

  // Part-scoped
  it("clefId", () => expect(clefId(0, 1)).toBe("p0/m1/clef"));
  it("keySigId", () => expect(keySigId(1, 0)).toBe("p1/m0/key"));
  it("dynamicId", () => expect(dynamicId(0, 2, 1)).toBe("p0/m2/dyn1"));
  it("hairpinId", () => expect(hairpinId(0, 0, 0)).toBe("p0/m0/hairpin0"));
  it("pedalId", () => expect(pedalId(0, 1, 2)).toBe("p0/m1/pedal2"));
  it("ottavaId", () => expect(ottavaId(1, 0, 0)).toBe("p1/m0/ottava0"));
  it("expressionId", () => expect(expressionId(0, 0, 3)).toBe("p0/m0/expr3"));
  it("chordSymbolId", () => expect(chordSymbolId(0, 1, 0)).toBe("p0/m1/chord0"));

  // Global
  it("timeSigId", () => expect(timeSigId(0)).toBe("m0/time"));
  it("barlineId", () => expect(barlineId(2)).toBe("m2/barline"));
  it("tempoId", () => expect(tempoId(0, 1)).toBe("m0/tempo1"));
  it("segnoId", () => expect(segnoId(0)).toBe("m0/segno"));
  it("codaId", () => expect(codaId(1)).toBe("m1/coda"));
  it("fineId", () => expect(fineId(0)).toBe("m0/fine"));
  it("jumpId", () => expect(jumpId(3)).toBe("m3/jump"));
  it("rehearsalId", () => expect(rehearsalId(0)).toBe("m0/rehearsal"));
  it("voltaId", () => expect(voltaId(0)).toBe("m0/volta"));
  it("measureNumberId", () => expect(measureNumberId(5)).toBe("m5/mnum"));
});

// ═══════════════════════════════════════════
// Extraction helpers
// ═══════════════════════════════════════════

describe("extraction helpers", () => {
  it("extractPartIndex from event ID", () => {
    expect(extractPartIndex("p0/m1/s0/ev1")).toBe(0);
    expect(extractPartIndex("p2/m0/clef")).toBe(2);
  });

  it("extractPartIndex returns undefined for global IDs", () => {
    expect(extractPartIndex("m0/time")).toBeUndefined();
    expect(extractPartIndex("m1/barline")).toBeUndefined();
  });

  it("extractMeasureIndex from various ID formats", () => {
    expect(extractMeasureIndex("p0/m3/s0/ev1")).toBe(3);
    expect(extractMeasureIndex("m5/time")).toBe(5);
    expect(extractMeasureIndex("p1/m0/dyn0")).toBe(0);
  });

  it("extractSequenceIndex from event ID", () => {
    expect(extractSequenceIndex("p0/m0/s2/ev1")).toBe(2);
  });

  it("extractSequenceIndex returns undefined for non-event IDs", () => {
    expect(extractSequenceIndex("p0/m0/dyn0")).toBeUndefined();
    expect(extractSequenceIndex("m0/time")).toBeUndefined();
  });

  it("extractNoteIndex from notehead ID", () => {
    expect(extractNoteIndex("p0/m0/s0/ev1/n2")).toBe(2);
    expect(extractNoteIndex("p0/m0/s0/ev1/n0")).toBe(0);
  });

  it("extractNoteIndex returns undefined for non-notehead IDs", () => {
    expect(extractNoteIndex("p0/m0/s0/ev1")).toBeUndefined();
    expect(extractNoteIndex("p0/m0/s0/ev1/art0")).toBeUndefined();
  });
});

// ═══════════════════════════════════════════
// getEventAncestorId
// ═══════════════════════════════════════════

describe("getEventAncestorId", () => {
  it("strips sub-element suffixes from event-attached IDs", () => {
    expect(getEventAncestorId("p0/m0/s0/ev1/art0")).toBe("p0/m0/s0/ev1");
    expect(getEventAncestorId("p0/m0/s0/ev1/n2")).toBe("p0/m0/s0/ev1");
    expect(getEventAncestorId("p0/m0/s0/ev1/ferm")).toBe("p0/m0/s0/ev1");
    expect(getEventAncestorId("p0/m0/s0/ev1/trem")).toBe("p0/m0/s0/ev1");
  });

  it("returns event IDs unchanged", () => {
    expect(getEventAncestorId("p0/m0/s0/ev1")).toBe("p0/m0/s0/ev1");
  });

  it("returns non-event IDs unchanged", () => {
    expect(getEventAncestorId("p0/m0/dyn0")).toBe("p0/m0/dyn0");
    expect(getEventAncestorId("m0/time")).toBe("m0/time");
  });
});

// ═══════════════════════════════════════════
// resolveEventLocation
// ═══════════════════════════════════════════

describe("resolveEventLocation", () => {
  it("resolves event by MNX model ID", () => {
    const score = makeScore();
    const loc = resolveEventLocation("p0/m0/s0/ev2", score);
    expect(loc).toEqual({ partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 1 });
  });

  it("resolves event by positional fallback (e{N})", () => {
    const score = makeScore();
    const loc = resolveEventLocation("p0/m0/s0/e0", score);
    expect(loc).toEqual({ partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 0 });
  });

  it("returns null for non-event IDs", () => {
    const score = makeScore();
    expect(resolveEventLocation("p0/m0/dyn0", score)).toBeNull();
    expect(resolveEventLocation("m0/time", score)).toBeNull();
  });

  it("returns null for invalid IDs", () => {
    const score = makeScore();
    expect(resolveEventLocation("invalid", score)).toBeNull();
    expect(resolveEventLocation("", score)).toBeNull();
  });
});

// ═══════════════════════════════════════════
// resolveEventFromSubElement
// ═══════════════════════════════════════════

describe("resolveEventFromSubElement", () => {
  it("resolves parent event from notehead sub-ID", () => {
    const score = makeScore();
    const loc = resolveEventFromSubElement("p0/m0/s0/ev1/n0", score);
    expect(loc).toEqual({ partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 0, noteIndex: 0 });
  });

  it("resolves parent event from articulation sub-ID", () => {
    const score = makeScore();
    const loc = resolveEventFromSubElement("p0/m0/s0/ev2/art0", score);
    expect(loc).toEqual({ partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 1 });
  });

  it("resolves event ID directly", () => {
    const score = makeScore();
    const loc = resolveEventFromSubElement("p0/m0/s0/ev3", score);
    expect(loc).toEqual({ partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 2 });
  });
});

// ═══════════════════════════════════════════
// resolveAnnotationLocation
// ═══════════════════════════════════════════

describe("resolveAnnotationLocation", () => {
  it("resolves part-level annotations", () => {
    expect(resolveAnnotationLocation("p0/m2/dyn0")).toEqual({
      kind: "part",
      type: "dyn",
      measureIndex: 2,
      partIndex: 0,
      annotationIndex: 0,
    });
    expect(resolveAnnotationLocation("p1/m0/hairpin1")).toEqual({
      kind: "part",
      type: "hairpin",
      measureIndex: 0,
      partIndex: 1,
      annotationIndex: 1,
    });
    expect(resolveAnnotationLocation("p0/m0/expr3")).toEqual({
      kind: "part",
      type: "expr",
      measureIndex: 0,
      partIndex: 0,
      annotationIndex: 3,
    });
  });

  it("resolves global annotations", () => {
    expect(resolveAnnotationLocation("m0/tempo0")).toEqual({
      kind: "global",
      type: "tempo",
      measureIndex: 0,
      annotationIndex: 0,
    });
    expect(resolveAnnotationLocation("m1/segno")).toEqual({
      kind: "global",
      type: "segno",
      measureIndex: 1,
    });
    expect(resolveAnnotationLocation("m0/rehearsal")).toEqual({
      kind: "global",
      type: "rehearsal",
      measureIndex: 0,
    });
  });

  it("returns null for event IDs", () => {
    expect(resolveAnnotationLocation("p0/m0/s0/ev1")).toBeNull();
  });

  it("returns null for invalid IDs", () => {
    expect(resolveAnnotationLocation("invalid")).toBeNull();
    expect(resolveAnnotationLocation("")).toBeNull();
  });
});

// ═══════════════════════════════════════════
// getEventAtLocation
// ═══════════════════════════════════════════

describe("getEventAtLocation", () => {
  it("returns the event at a valid location", () => {
    const score = makeScore();
    const ev = getEventAtLocation(score, { partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 1 });
    expect(ev).toBeDefined();
    expect((ev as NoteEvent).id).toBe("ev2");
  });

  it("returns null for out-of-bounds location", () => {
    const score = makeScore();
    expect(getEventAtLocation(score, { partIndex: 9, measureIndex: 0, sequenceIndex: 0, eventIndex: 0 })).toBeNull();
  });
});
