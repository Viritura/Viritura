import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "MNX Spec/Instruments & Parts/Transposition",
  component: ScorePreview,
};
export default meta;

// ---------------------------------------------------------------------------
// MNX `transposition.interval` semantics
// ---------------------------------------------------------------------------
// MNX models the interval as **sounding → written** (engine: part.rs:23).
// To compute the interval for an instrument, ask: starting from a sounding
// pitch, what direction and distance do I move on the staff to get the
// written pitch?
//
//   * B♭ Clarinet sounds a M2 BELOW written → sounding C4 → written D4
//       → halfSteps = +2, staffDistance = +1
//   * F Horn      sounds a P5 BELOW written → sounding C4 → written G4
//       → halfSteps = +7, staffDistance = +4
//   * E♭ Alto Sax sounds a M6 BELOW written → halfSteps = +9, staffDistance = +5
//   * B♭ Trumpet  sounds a M2 BELOW written → halfSteps = +2, staffDistance = +1
//   * Piccolo     sounds an 8va ABOVE written → sounding C5 → written C4
//       → halfSteps = -12, staffDistance = -7
//   * Double Bass sounds an 8va BELOW written → sounding C2 → written C3
//       → halfSteps = +12, staffDistance = +7
// ---------------------------------------------------------------------------

interface Instrument {
  name: string;
  shortName: string;
  /** sounding → written interval, in semitones. */
  halfSteps: number;
  /** sounding → written interval, in diatonic steps. */
  staffDistance: number;
  /** Description shown above each preview. */
  description: string;
  clef?: { sign: string; staffPosition: number };
}

const TREBLE = { sign: "G", staffPosition: -2 };

const INSTRUMENTS: Record<string, Instrument> = {
  bbClarinet: {
    name: "Clarinet in B\u266D",
    shortName: "Cl.",
    halfSteps: 2,
    staffDistance: 1,
    description: "B\u266D Clarinet — sounds a major 2nd below written",
    clef: TREBLE,
  },
  fHorn: {
    name: "Horn in F",
    shortName: "Hn.",
    halfSteps: 7,
    staffDistance: 4,
    description: "F Horn — sounds a perfect 5th below written",
    clef: TREBLE,
  },
  ebAltoSax: {
    name: "Alto Saxophone in E\u266D",
    shortName: "A. Sx.",
    halfSteps: 9,
    staffDistance: 5,
    description: "E\u266D Alto Sax — sounds a major 6th below written",
    clef: TREBLE,
  },
  bbTrumpet: {
    name: "Trumpet in B\u266D",
    shortName: "Tpt.",
    halfSteps: 2,
    staffDistance: 1,
    description: "B\u266D Trumpet — sounds a major 2nd below written",
    clef: TREBLE,
  },
  piccolo: {
    name: "Piccolo",
    shortName: "Picc.",
    halfSteps: -12,
    staffDistance: -7,
    description: "Piccolo — sounds an octave above written",
    clef: TREBLE,
  },
  doubleBass: {
    name: "Double Bass",
    shortName: "Cb.",
    halfSteps: 12,
    staffDistance: 7,
    description: "Double Bass — sounds an octave below written",
    clef: { sign: "F", staffPosition: 2 },
  },
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

interface BuildOptions {
  /** Concert pitches to write into the part (always concert; the renderer
   *  applies transposition when `useWritten` is true on the score). */
  concertNotes: { step: string; octave: number }[];
  fifths?: number;
  clef?: { sign: string; staffPosition: number };
}

function buildScore(instr: Instrument | null, useWritten: boolean, opts: BuildOptions): string {
  const { concertNotes, fifths = 0, clef } = opts;
  const effectiveClef = clef ?? instr?.clef ?? TREBLE;
  const part: Record<string, unknown> = {
    id: "P1",
    name: instr ? instr.name : "Concert Pitch",
    shortName: instr ? instr.shortName : "C.",
    measures: [
      {
        clefs: [{ clef: effectiveClef }],
        sequences: [
          {
            content: concertNotes.map((n) => ({
              type: "event",
              duration: { base: "quarter" },
              notes: [{ pitch: { step: n.step, octave: n.octave } }],
            })),
          },
        ],
      },
    ],
  };
  if (instr) {
    part.transposition = {
      interval: { halfSteps: instr.halfSteps, staffDistance: instr.staffDistance },
    };
  }
  return JSON.stringify(
    {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 }, key: { fifths } }] },
      parts: [part],
      scores: [{ name: useWritten ? "Written Pitch" : "Concert Pitch", useWritten }],
    },
    null,
    2,
  );
}

// Stable C-major scale fragment, written in concert pitch.
const CONCERT_SCALE: BuildOptions["concertNotes"] = [
  { step: "C", octave: 4 },
  { step: "D", octave: 4 },
  { step: "E", octave: 4 },
  { step: "F", octave: 4 },
];

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Concert vs Written — same B♭ Clarinet part, two views.
// The notes in the MNX file are concert (C–D–E–F); the renderer transposes
// them up a major 2nd (D–E–F♯–G) when `useWritten = true`. Concert key
// C major (0 fifths) → written D major (2 sharps).
// ---------------------------------------------------------------------------

export const BbClarinetConcert: StoryObj = {
  render: () => <ScorePreview mnxJson={buildScore(INSTRUMENTS.bbClarinet!, false, { concertNotes: CONCERT_SCALE })} />,
  name: "B\u266D clarinet at concert pitch",
};

export const BbClarinetWritten: StoryObj = {
  render: () => <ScorePreview mnxJson={buildScore(INSTRUMENTS.bbClarinet!, true, { concertNotes: CONCERT_SCALE })} />,
  name: "B\u266D clarinet at written pitch",
};

// ---------------------------------------------------------------------------
// Common transposing instruments rendered in **written pitch** from the same
// concert C-major scale. Each story shows the player's part — what they read
// on the page.
// ---------------------------------------------------------------------------

const writtenPreview = (key: keyof typeof INSTRUMENTS, notes: BuildOptions["concertNotes"] = CONCERT_SCALE) => (
  <ScorePreview mnxJson={buildScore(INSTRUMENTS[key]!, true, { concertNotes: notes })} />
);

// Piccolo's practical range is roughly D5–C8 sounding (D4–C7 written).
// Use concert G6–C7 so the written part lands on G5–C6 — comfortable mid-staff.
const PICCOLO_CONCERT: BuildOptions["concertNotes"] = [
  { step: "G", octave: 6 },
  { step: "A", octave: 6 },
  { step: "B", octave: 6 },
  { step: "C", octave: 7 },
];

// Double bass sounds an octave below written. Practical sounding range is
// roughly E1–G3 (written E2–G4). Use concert E2–A2 so the written part lands
// on E3–A3 — squarely in the bass-clef staff.
const DOUBLE_BASS_CONCERT: BuildOptions["concertNotes"] = [
  { step: "E", octave: 2 },
  { step: "F", octave: 2 },
  { step: "G", octave: 2 },
  { step: "A", octave: 2 },
];

export const BbClarinet: StoryObj = {
  render: () => writtenPreview("bbClarinet"),
  name: "B\u266D clarinet sounds a major second below",
};

export const BbTrumpet: StoryObj = {
  render: () => writtenPreview("bbTrumpet"),
  name: "B\u266D trumpet sounds a major second below",
};

export const FHorn: StoryObj = {
  render: () => writtenPreview("fHorn"),
  name: "F horn sounds a perfect fifth below",
};

export const EbAltoSax: StoryObj = {
  render: () => writtenPreview("ebAltoSax"),
  name: "E\u266D alto saxophone sounds a major sixth below",
};

export const Piccolo: StoryObj = {
  render: () => writtenPreview("piccolo", PICCOLO_CONCERT),
  name: "Piccolo sounds 8va above",
};

export const DoubleBass: StoryObj = {
  render: () => writtenPreview("doubleBass", DOUBLE_BASS_CONCERT),
  name: "Double bass sounds 8vb below",
};

// ---------------------------------------------------------------------------
// Key Signature Transposition — same concert key (B♭ major, -2 fifths) shown
// for several instruments. The key on the page differs because the
// transposition rotates the circle of fifths along with the notes.
// ---------------------------------------------------------------------------

const KEY_TRANSP_FIFTHS = -2; // concert B♭ major
const KEY_TRANSP_NOTES: BuildOptions["concertNotes"] = [
  { step: "B", octave: 3 },
  { step: "C", octave: 4 },
  { step: "D", octave: 4 },
  { step: "F", octave: 4 },
];

const keyTranspPreview = (key: keyof typeof INSTRUMENTS) => (
  <ScorePreview
    mnxJson={buildScore(INSTRUMENTS[key]!, true, { concertNotes: KEY_TRANSP_NOTES, fifths: KEY_TRANSP_FIFTHS })}
  />
);

export const KeyTransposeConcert: StoryObj = {
  render: () => (
    <ScorePreview mnxJson={buildScore(null, false, { concertNotes: KEY_TRANSP_NOTES, fifths: KEY_TRANSP_FIFTHS })} />
  ),
  name: "Concert B\u266D major (two flats)",
};

export const KeyTransposeBbClarinet: StoryObj = {
  render: () => keyTranspPreview("bbClarinet"),
  name: "B\u266D clarinet written in C major",
};

export const KeyTransposeBbTrumpet: StoryObj = {
  render: () => keyTranspPreview("bbTrumpet"),
  name: "B\u266D trumpet written in C major",
};

export const KeyTransposeFHorn: StoryObj = {
  render: () => keyTranspPreview("fHorn"),
  name: "F horn written in F major",
};

export const KeyTransposeEbAltoSax: StoryObj = {
  render: () => keyTranspPreview("ebAltoSax"),
  name: "E\u266D alto saxophone written in G major",
};
