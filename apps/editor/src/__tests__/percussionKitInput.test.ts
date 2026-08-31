/**
 * End-to-end regression test: verify that adding kit-notes through the same
 * code path the UI uses produces an MNX JSON with distinct `staffPosition`
 * values per kit-component. Catches the "all drum hits land on middle line"
 * regression by inspecting the serialized MNX directly.
 */
import { describe, it, expect } from "vitest";
import type { Score } from "@viritura/core";
import { addInstrumentToScore } from "../score/ScoreMutations";
import { addNote } from "../commands/noteCommands";
import { serializeMnx } from "@viritura/format";

function emptyScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [],
    layouts: [{ id: "L-full", content: [] }],
    scores: [{ name: "Full Score", layout: "L-full" }],
  } as Score;
}

describe("Percussion drum-kit input → MNX round trip", () => {
  it("addInstrumentToScore('drum-kit') populates part.kit with distinct staffPositions", () => {
    const s0 = emptyScore();
    const s1 = addInstrumentToScore(s0, "drum-kit");
    const part = s1.parts[0]!;
    expect(part.kit).toBeDefined();
    const positions = Object.entries(part.kit!).map(([id, c]) => ({ id, sp: c.staffPosition }));
    const uniqueSPs = new Set(positions.map((p) => p.sp));
    expect(uniqueSPs.size).toBeGreaterThan(1);
    // Sanity: kick is below middle, crash is above middle.
    const kick = part.kit!["kick"];
    const crash = part.kit!["crash"];
    expect(kick).toBeDefined();
    expect(crash).toBeDefined();
    expect(kick!.staffPosition).toBeLessThan(0);
    expect(crash!.staffPosition).toBeGreaterThan(0);
  });

  it("addNote with kitComponent produces an event with kitNotes", () => {
    let s = emptyScore();
    s = addInstrumentToScore(s, "drum-kit");
    s = addNote(s, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
      kitComponent: "kick",
    });
    const seq = s.parts[0]!.measures[0]!.sequences[0]!;
    const ev = seq.content.find((c) => c.type === "event") as { kitNotes?: Array<{ kitComponent: string }> };
    expect(ev).toBeDefined();
    expect(ev.kitNotes).toBeDefined();
    expect(ev.kitNotes![0]!.kitComponent).toBe("kick");
  });

  it("serializeMnx(score) emits part.kit with staffPosition for every kit component", () => {
    let s = emptyScore();
    s = addInstrumentToScore(s, "drum-kit");
    s = addNote(s, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
      kitComponent: "kick",
    });
    s = addNote(s, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1,
      kitComponent: "snare",
    });
    const out = serializeMnx(s) as { parts: Array<Record<string, unknown>> };
    const part0 = out.parts[0]!;
    expect(part0["kit"]).toBeDefined();
    const kit = part0["kit"] as Record<string, { staffPosition: number }>;
    // Every component must have a numeric staffPosition.
    for (const [id, comp] of Object.entries(kit)) {
      expect(typeof comp.staffPosition, `kit[${id}].staffPosition missing`).toBe("number");
    }
    // The kit JSON must contain at least one negative and one positive position.
    const sps = Object.values(kit).map((c) => c.staffPosition);
    expect(sps.some((sp) => sp < 0)).toBe(true);
    expect(sps.some((sp) => sp > 0)).toBe(true);

    // Verify kitNotes carry the right component IDs.
    const measures = part0["measures"] as Array<{ sequences: Array<{ content: Array<Record<string, unknown>> }> }>;
    const events = measures[0]!.sequences[0]!.content.filter((c) => c["kitNotes"]);
    expect(events.length).toBe(2);
    const kn0 = (events[0]!["kitNotes"] as Array<{ kitComponent: string }>)[0]!;
    const kn1 = (events[1]!["kitNotes"] as Array<{ kitComponent: string }>)[0]!;
    expect(kn0.kitComponent).toBe("kick");
    expect(kn1.kitComponent).toBe("snare");
  });
});
