import { describe, expect, it } from "vitest";
import type { Note, Transposition } from "@viritura/core";
import { parseMuseScoreNote } from "./noteReading";
import { diatonicPosition, parseStaffTransposition, staffTranspositionXml, writtenPitchForNote } from "./transposition";
import { child, children, parseSafeXml } from "./xml";

// Complete stafflist.xml from the user capture 20260918-003731-328-e56216e7.
// capture.json: complete=true, 723 bytes, notes="Transposing - doublebass".
const DOUBLE_BASS_CAPTURE = `<?xml version="1.0" encoding="UTF-8"?>
<StaffList version="4.70" tick="11/4" len="6/8" staff="28" staves="1">
  <Staff id="28">
    <transposeChromatic>-12</transposeChromatic>
    <transposeDiatonic>-7</transposeDiatonic>
    <voiceOffset>
      <voice id="0">0</voice>
      </voiceOffset>
    <location>
      <fractions>11/4</fractions>
      </location>
    <Chord>
      <dots>1</dots>
      <durationType>quarter</durationType>
      <Note>
        <pitch>29</pitch>
        <tpc>13</tpc>
        </Note>
      </Chord>
    <Chord>
      <dots>1</dots>
      <durationType>quarter</durationType>
      <Note>
        <pitch>31</pitch>
        <tpc>15</tpc>
        </Note>
      </Chord>
    </Staff>
  </StaffList>
`;

function parse(fields: string): Transposition | undefined {
  return parseStaffTransposition(parseSafeXml(`<Staff>${fields}</Staff>`).documentElement, "Staff");
}

const CLARINET: Transposition = { interval: { halfSteps: 2, staffDistance: 1 } };
const BASS: Transposition = { interval: { halfSteps: 12, staffDistance: 7 }, prefersWrittenPitches: true };

describe("MuseScore source Staff transposition", () => {
  it("reads the captured double bass without transposing its authoritative sounding pitches", () => {
    const staff = child(parseSafeXml(DOUBLE_BASS_CAPTURE).documentElement, "Staff")!;
    const transposition = parseStaffTransposition(staff, "Staff[28]");
    expect(transposition).toEqual(BASS);
    const notes = children(staff, "Chord").map((chord) =>
      parseMuseScoreNote(child(chord, "Note")!, "Staff[28]/Note", transposition),
    );
    expect(notes.map((note) => note.pitch)).toEqual([
      { step: "F", octave: 1 },
      { step: "G", octave: 1 },
    ]);
    expect(notes.map((note) => writtenPitchForNote(note, transposition, "Note"))).toEqual([
      { step: "F", octave: 2 },
      { step: "G", octave: 2 },
    ]);
    expect(notes.map((note) => writtenPitchForNote(note, undefined, "Note"))).toEqual(notes.map((note) => note.pitch));
    expect(notes[0]?.pitch).toEqual({ step: "F", octave: 1 });
  });

  it.each([
    ["", undefined],
    ["<transposeChromatic>0</transposeChromatic><transposeDiatonic>0</transposeDiatonic>", undefined],
    ["<transposeChromatic>-2</transposeChromatic><transposeDiatonic>-1</transposeDiatonic>", CLARINET],
    [
      "<transposeChromatic>12</transposeChromatic><transposeDiatonic>7</transposeDiatonic>",
      { interval: { halfSteps: -12, staffDistance: -7 }, prefersWrittenPitches: true },
    ],
    [
      "<transposeChromatic>24</transposeChromatic><transposeDiatonic>14</transposeDiatonic>",
      { interval: { halfSteps: -24, staffDistance: -14 }, prefersWrittenPitches: true },
    ],
    ["<transposeChromatic>-1</transposeChromatic>", { interval: { halfSteps: 1, staffDistance: 0 } }],
    ["<transposeDiatonic>-1</transposeDiatonic>", { interval: { halfSteps: 0, staffDistance: 1 } }],
  ])("reads independently omitted zero components: %s", (fields, expected) => {
    expect(parse(fields)).toEqual(expected);
  });

  it.each([
    "<transposeChromatic>1.5</transposeChromatic>",
    "<transposeDiatonic>1e1</transposeDiatonic>",
    "<transposeChromatic/>",
    "<transposeDiatonic>9007199254740992</transposeDiatonic>",
    "<transposeChromatic>128</transposeChromatic>",
    "<transposeDiatonic>-129</transposeDiatonic>",
    "<transposeChromatic>1</transposeChromatic><transposeChromatic>2</transposeChromatic>",
    "<transposeDiatonic>1</transposeDiatonic><transposeDiatonic>1</transposeDiatonic>",
    "<transposeChromatic><value>-12</value></transposeChromatic>",
    '<transposeDiatonic unit="steps">-7</transposeDiatonic>',
  ])("rejects malformed scalar source intervals: %s", (fields) => {
    expect(() => parse(fields)).toThrow(expect.objectContaining({ code: "invalid-structure" }));
  });

  it("exports source written-to-sounding signs, omitting zeros just like select.cpp", () => {
    expect(staffTranspositionXml(BASS, "Staff")).toBe(
      "<transposeChromatic>-12</transposeChromatic><transposeDiatonic>-7</transposeDiatonic>",
    );
    expect(staffTranspositionXml(CLARINET, "Staff")).toBe(
      "<transposeChromatic>-2</transposeChromatic><transposeDiatonic>-1</transposeDiatonic>",
    );
    expect(staffTranspositionXml(undefined, "Staff")).toBe("");
    expect(staffTranspositionXml({ interval: { halfSteps: 0, staffDistance: 0 } }, "Staff")).toBe("");
    expect(staffTranspositionXml({ interval: { halfSteps: 1, staffDistance: 0 } }, "Staff")).toBe(
      "<transposeChromatic>-1</transposeChromatic>",
    );
  });

  it.each([NaN, Infinity, 1.5, -128, 129])(
    "rejects native interval values that would wrap or truncate: %s",
    (value) => {
      for (const interval of [
        { halfSteps: value, staffDistance: 0 },
        { halfSteps: 0, staffDistance: value },
      ]) {
        expect(() => staffTranspositionXml({ interval }, "Staff")).toThrow(
          expect.objectContaining({ code: "invalid-structure" }),
        );
      }
    },
  );

  it("derives standard written spelling and preserves an explicit native enharmonic delta", () => {
    const note: Note = { pitch: { step: "B", octave: 3, alter: -1 } };
    expect(writtenPitchForNote(note, CLARINET, "Note")).toEqual({ step: "C", octave: 4 });
    const respelled: Note = { ...note, written: { diatonicDelta: -1 } };
    expect(writtenPitchForNote(respelled, CLARINET, "Note")).toEqual({ step: "B", octave: 3, alter: 1 });
    expect(note.pitch).toEqual({ step: "B", octave: 3, alter: -1 });
    expect(diatonicPosition({ step: "C", octave: 4 })).toBe(28);
  });

  it("reports key-context flips and unrepresentable written notes rather than clamping or respelling", () => {
    expect(() => staffTranspositionXml({ ...CLARINET, keyFifthsFlipAt: 6 }, "Staff")).toThrow(
      expect.objectContaining({ code: "unsupported-content" }),
    );
    expect(() => writtenPitchForNote({ pitch: { step: "C", octave: 9 } }, BASS, "Note")).toThrow(/octave range/);
    expect(() => writtenPitchForNote({ pitch: { step: "B", octave: 4, alter: 3 } }, CLARINET, "Note")).toThrow(
      /triple-accidental range/,
    );
    expect(() =>
      writtenPitchForNote({ pitch: { step: "C", octave: 4 }, written: { diatonicDelta: 1 } }, undefined, "Note"),
    ).toThrow(/without source transposition/);
    expect(() =>
      writtenPitchForNote({ pitch: { step: "C", octave: 4 }, written: { diatonicDelta: 0.5 } }, CLARINET, "Note"),
    ).toThrow(expect.objectContaining({ code: "invalid-structure" }));
  });
});
