import { describe, it, expect } from "vitest";
import type { Score } from "@viritura/core";
import { generateTimeline } from "../timeline";
import type { MidiEvent } from "../types";

/**
 * Regression: a multi-voice part (e.g. piano, two hands) must keep each voice's
 * tie and legato pairing state independent. Before the per-voice fix, tie /
 * legato noteOff state was keyed only by `midiNote:partIndex`, so two voices
 * sharing a pitch cross-contaminated each other's noteOn/noteOff pairing —
 * leaving notes that never released ("stuck through the rest of the song").
 */

type Step = "C" | "D" | "E" | "F" | "G" | "A" | "B";

interface EvtSpec {
  step: Step;
  octave: number;
  base?: string;
  id?: string;
  tieTo?: string;
  slurTo?: string;
}

function evt(s: EvtSpec) {
  const note: Record<string, unknown> = { pitch: { step: s.step, octave: s.octave } };
  // Tie targets reference NOTE ids; slur targets reference EVENT ids.
  if (s.id) note.id = s.id;
  if (s.tieTo) note.ties = [{ target: s.tieTo }];
  const e: Record<string, unknown> = {
    type: "event",
    duration: { base: s.base ?? "quarter" },
    notes: [note],
  };
  if (s.id) e.id = s.id;
  if (s.slurTo) e.slurs = [{ target: s.slurTo }];
  return e;
}

/** One piano part; each measure carries two voices (sequences). */
function buildTwoVoiceScore(measures: { v1: EvtSpec[]; v2: EvtSpec[] }[]): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: measures.map(() => ({
        time: { count: 4, unit: 4 },
        tempos: [{ bpm: 120, value: { base: "quarter" } } as never],
      })),
    },
    parts: [
      {
        id: "pno",
        name: "Piano",
        measures: measures.map((m) => ({
          sequences: [
            { voice: "1", content: m.v1.map(evt) },
            { voice: "2", content: m.v2.map(evt) },
          ],
        })),
      } as never,
    ],
  };
}

/** Pair noteOn/noteOff FIFO per part:channel:midi, like projectToRoll does. */
function pairNotes(tl: ReturnType<typeof generateTimeline>) {
  const open = new Map<string, MidiEvent[]>();
  const key = (e: MidiEvent) => `${e.partIndex}:${e.channel}:${e.midiNote}`;
  const notes: { midi: number; on: number; off: number; len: number }[] = [];
  let unpaired = 0;
  for (const ev of tl.events) {
    if (ev.type === "noteOn") {
      const k = key(ev);
      const st = open.get(k) ?? [];
      st.push(ev);
      open.set(k, st);
    } else if (ev.type === "noteOff") {
      const on = open.get(key(ev))?.shift();
      if (on) notes.push({ midi: ev.midiNote, on: on.time, off: ev.time, len: ev.time - on.time });
    }
  }
  for (const st of open.values()) unpaired += st.length;
  return { notes, unpaired };
}

describe("generateTimeline — multi-voice tie/legato pairing", () => {
  it("keeps each voice's tie independent when both tie the same pitch", () => {
    // Both voices tie C4 (midi 60) across the bar line. With per-part tie keys
    // the second voice's tie clobbered the first's pending noteOff, leaving an
    // unpaired (stuck) noteOn. Per-voice keying releases both correctly.
    const score = buildTwoVoiceScore([
      {
        v1: [{ step: "C", octave: 4, base: "whole", id: "a1", tieTo: "a2" }],
        v2: [{ step: "C", octave: 4, base: "whole", id: "b1", tieTo: "b2" }],
      },
      {
        v1: [{ step: "C", octave: 4, base: "whole", id: "a2" }],
        v2: [{ step: "C", octave: 4, base: "whole", id: "b2" }],
      },
    ]);
    const tl = generateTimeline(score);
    const { notes, unpaired } = pairNotes(tl);
    // The headline regression: no orphaned noteOn (would be the stuck note).
    expect(unpaired).toBe(0);
    // Two C4 notes, each sustaining the full tied 2-whole-note span (~4s),
    // neither running away to the end of the piece.
    expect(notes).toHaveLength(2);
    for (const n of notes) {
      expect(n.len).toBeGreaterThan(3.5);
      expect(n.len).toBeLessThan(4.5);
    }
  });

  it("does not leak a slur's deferred legato across voices that share a pitch", () => {
    // Voice 1 slurs a phrase on C4; voice 2 also plays C4. The deferred legato
    // off for voice 1 must not be resolved by voice 2's note (or vice versa).
    const score = buildTwoVoiceScore([
      {
        v1: [
          { step: "C", octave: 4, id: "s1", slurTo: "s3" },
          { step: "C", octave: 4, id: "s2" },
          { step: "C", octave: 4, id: "s3" },
          { step: "C", octave: 4, id: "s4" },
        ],
        v2: [
          { step: "C", octave: 4 },
          { step: "C", octave: 4 },
          { step: "C", octave: 4 },
          { step: "C", octave: 4 },
        ],
      },
    ]);
    const tl = generateTimeline(score);
    const { notes, unpaired } = pairNotes(tl);
    expect(unpaired).toBe(0);
    // Every note releases within the single bar (2s) — nothing stuck.
    expect(Math.max(...notes.map((n) => n.len))).toBeLessThan(2.2);
  });
});
