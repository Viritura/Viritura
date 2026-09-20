import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DURATION_BEATS, pitchToMidi, walkSequenceEvents, type NoteEvent, type SequenceContent } from "@viritura/core";
import {
  MUSESCORE_STAFF_LIST_MIME,
  readMuseScoreClipboard,
  writeMuseScoreStaffList,
  type MuseScoreClipboardData,
  type MuseScoreClipboardWriteInput,
} from ".";

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/realCaptures/${name}.xml`, import.meta.url), "utf8");
}

function events(content: SequenceContent[]): NoteEvent[] {
  return [...walkSequenceEvents(content)].map(({ event }) => event);
}

function pitches(content: SequenceContent[]): number[][] {
  return events(content).map((event) => event.notes!.map((note) => pitchToMidi(note.pitch)));
}

function durations(content: SequenceContent[]): number[] {
  return events(content).map(({ duration }) => (DURATION_BEATS[duration.base] * (2 - 2 ** -(duration.dots ?? 0))) / 4);
}

function roundTrip(data: MuseScoreClipboardData) {
  const input: MuseScoreClipboardWriteInput = {
    events: data.content,
    tracks: data.tracks,
    transposition: data.transposition,
    dynamics: data.dynamics,
    chordSymbols: data.chordSymbols,
  };
  const before = structuredClone(input);
  const result = writeMuseScoreStaffList(input);
  expect(result.warning).toBeUndefined();
  expect(result.xml).toContain('<StaffList version="4.70" tick="0/1" len="3/4"');
  expect(result.xml).not.toMatch(/<(?:velocity|play|veloChange|veloChangeSpeed|singleNoteDynamics|veloChangeMethod)>/);
  expect(input).toEqual(before);
  return { xml: result.xml!, parsed: readMuseScoreClipboard(result.xml!, MUSESCORE_STAFF_LIST_MIME) };
}

function tieEdges(content: SequenceContent[]): number[][] {
  const notes = events(content).flatMap((event) => event.notes!);
  expect(new Set(notes.map((note) => note.id)).size).toBe(notes.length);
  return notes.flatMap((note, source) =>
    (note.ties ?? []).map((tie) => {
      const target = notes.findIndex((candidate) => candidate.id === tie.target);
      expect(target).toBeGreaterThanOrEqual(0);
      expect(notes[target]!.pitch).toEqual(note.pitch);
      return [source, target];
    }),
  );
}

describe("exact real MuseScore 4.70 clipboard captures without editor state", () => {
  it.each([
    { name: "hairpin", midi: [[63], [65], [67]], lengths: [1 / 4, 1 / 8, 3 / 8] },
    { name: "doublebass", midi: [[29], [31]], lengths: [3 / 8, 3 / 8] },
    { name: "natural", midi: [[60], [59]], lengths: [3 / 8, 3 / 8] },
    {
      name: "ties",
      midi: [[63], [62], [63], [65], [65], [63], [63]],
      lengths: [3 / 16, 1 / 16, 1 / 8, 1 / 8, 1 / 16, 1 / 16, 1 / 8],
    },
    {
      name: "pianoLowerDynamics",
      midi: [
        [60, 63, 67],
        [63, 67, 70],
      ],
      lengths: [3 / 8, 3 / 8],
    },
  ])("normalizes $name source-absolute timing exactly once", ({ name, midi, lengths }) => {
    const xml = fixture(name);
    expect(xml).toMatch(/tick="(?!0\/1)/);
    expect(xml).toContain('len="6/8"');
    const parsed = readMuseScoreClipboard(xml, MUSESCORE_STAFF_LIST_MIME);
    for (const data of [parsed, roundTrip(parsed).parsed]) {
      expect(pitches(data.content)).toEqual(midi);
      expect(durations(data.content)).toEqual(lengths);
      for (const track of data.tracks ?? [{ content: data.content }]) {
        expect(durations(track.content).reduce((sum, duration) => sum + duration, 0)).toBe(3 / 4);
      }
    }
  });

  it("keeps a complete crescendo endpoint exactly at the selection end", () => {
    const parsed = readMuseScoreClipboard(fixture("hairpin"));
    const written = roundTrip(parsed);
    for (const data of [parsed, written.parsed]) {
      expect(data.dynamics).toEqual([
        {
          staffOffset: 0,
          measureOffset: 0,
          endMeasureOffset: 0,
          offset: [0, 1],
          endOffset: [3, 4],
          dynamic: {
            id: expect.any(String),
            type: "gradual",
            value: "mf",
            wedgeType: "increasing",
            position: { fraction: [0, 1] },
            end: { measure: "0", position: { fraction: [3, 4] } },
          },
        },
      ]);
    }
    expect(written.xml.match(/<Spanner type="HairPin">/g)).toHaveLength(2);
    expect(written.xml).toContain("<ticks_f>3/4</ticks_f>");
  });

  it("preserves double-bass sounding F1/G1 and -12/-7 source metadata without another transpose", () => {
    const xml = fixture("doublebass");
    expect(xml).toContain("<transposeChromatic>-12</transposeChromatic>");
    expect(xml).toContain("<transposeDiatonic>-7</transposeDiatonic>");
    const parsed = readMuseScoreClipboard(xml);
    const written = roundTrip(parsed);
    expect(written.xml).toContain("<transposeChromatic>-12</transposeChromatic>");
    expect(written.xml).toContain("<transposeDiatonic>-7</transposeDiatonic>");
    for (const data of [parsed, written.parsed]) {
      expect(data.tracks?.[0]?.transposition).toEqual({
        interval: { halfSteps: 12, staffDistance: 7 },
        prefersWrittenPitches: true,
      });
      expect(events(data.content).map((event) => event.notes![0]!.pitch)).toEqual([
        { step: "F", octave: 1 },
        { step: "G", octave: 1 },
      ]);
      expect(pitches(data.content)).toEqual([[29], [31]]);
    }
  });

  it("preserves the explicit B-natural display after C4", () => {
    const parsed = readMuseScoreClipboard(fixture("natural"));
    const written = roundTrip(parsed);
    expect(written.xml).toContain("<subtype>accidentalNatural</subtype>");
    for (const data of [parsed, written.parsed]) {
      expect(events(data.content)[1]!.notes![0]).toMatchObject({
        pitch: { step: "B", octave: 3 },
        accidentalDisplay: { show: true, force: false },
      });
    }
  });

  it("retains both reciprocal tie identities at the exact source onsets", () => {
    const parsed = readMuseScoreClipboard(fixture("ties"));
    const written = roundTrip(parsed);
    expect(tieEdges(parsed.content)).toEqual([
      [3, 4],
      [5, 6],
    ]);
    expect(tieEdges(written.parsed.content)).toEqual([
      [3, 4],
      [5, 6],
    ]);
    expect(written.xml).toContain("<ticks_f>1/8</ticks_f>");
    expect(written.xml).toContain("<ticks_f>1/16</ticks_f>");
    expect(written.xml.match(/<Spanner type="Tie">/g)).toHaveLength(4);
  });

  it("imports lower-piano mp49 as semantic mp only, leaving Cm and E-flat on the upper staff", () => {
    const parsed = readMuseScoreClipboard(fixture("pianoLowerDynamics"));
    for (const data of [parsed, roundTrip(parsed).parsed]) {
      expect(data.tracks).toMatchObject([
        { partOffset: 0, staffOffset: 0, voiceIndex: 0 },
        { partOffset: 0, staffOffset: 1, voiceIndex: 0 },
      ]);
      expect(pitches(data.tracks![1]!.content)).toEqual([[48], [46], [48], [50], [46], [50]]);
      expect(data.dynamics).toEqual([
        {
          partOffset: 0,
          staffOffset: 1,
          measureOffset: 0,
          offset: [0, 1],
          dynamic: {
            id: expect.any(String),
            type: "immediate",
            value: "mp",
            position: { fraction: [0, 1] },
          },
        },
      ]);
      expect(data.chordSymbols).toMatchObject([
        { staffOffset: 0, offset: [0, 1], chordSymbol: { root: { step: "C" }, quality: "minor" } },
        { staffOffset: 0, offset: [3, 8], chordSymbol: { root: { step: "E", alter: -1 }, quality: "major" } },
      ]);
      expect(JSON.stringify(data)).not.toContain("velocity");
    }
  });
});
