/* eslint-disable max-lines -- Cohesive catalog of verbose slur rendering fixtures shared by focused CSF story files. */
/**
 * Comprehensive slur engraving test cases.
 *
 * Each story exercises a different aspect of slur layout:
 *   - direction (ascending / descending / flat / mountain / valley)
 *   - span (2..N notes, full measure, cross-barline)
 *   - forced side (up / down / auto)
 *   - pitch register (high / low / on-line / in-space / ledger)
 *   - note types (chords, dotted, with rests)
 *   - articulation interaction (staccato / accent / marcato)
 *   - nesting and overlapping
 *   - multi-voice
 *
 * Compare visual output against industry-standard engravers reference engravings.
 */

import type { StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

// ───────────────────────────────────────────────────────────────
// Span (number of notes)
// ───────────────────────────────────────────────────────────────

export const TwoNoteSlur: StoryObj = {
  name: "Two-note slurs on eighth notes",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "eighth", id: "t1", notes: [{ step: "C", octave: 5 }], slurs: [{ target: "t2" }] },
              { duration: "eighth", id: "t2", notes: [{ step: "D", octave: 5 }] },
              { duration: "eighth", id: "t3", notes: [{ step: "E", octave: 5 }], slurs: [{ target: "t4" }] },
              { duration: "eighth", id: "t4", notes: [{ step: "F", octave: 5 }] },
              { duration: "eighth", id: "t5", notes: [{ step: "G", octave: 5 }], slurs: [{ target: "t6" }] },
              { duration: "eighth", id: "t6", notes: [{ step: "A", octave: 5 }] },
              { duration: "eighth", id: "t7", notes: [{ step: "B", octave: 5 }], slurs: [{ target: "t8" }] },
              { duration: "eighth", id: "t8", notes: [{ step: "C", octave: 6 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const ThreeNoteSlur: StoryObj = {
  name: "Three-note slur",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 3, unit: 4 },
          voices: [
            [
              { duration: "quarter", id: "n1", notes: [{ step: "C", octave: 5 }], slurs: [{ target: "n3" }] },
              { duration: "quarter", id: "n2", notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", id: "n3", notes: [{ step: "E", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const FourNoteSlur: StoryObj = {
  name: "Four-note slur",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", id: "q1", notes: [{ step: "C", octave: 5 }], slurs: [{ target: "q4" }] },
              { duration: "quarter", id: "q2", notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", id: "q3", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", id: "q4", notes: [{ step: "F", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const EightNoteSlur: StoryObj = {
  name: "Eight-note slur across a full measure",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "eighth", id: "e1", notes: [{ step: "C", octave: 5 }], slurs: [{ target: "e8" }] },
              { duration: "eighth", id: "e2", notes: [{ step: "D", octave: 5 }] },
              { duration: "eighth", id: "e3", notes: [{ step: "E", octave: 5 }] },
              { duration: "eighth", id: "e4", notes: [{ step: "F", octave: 5 }] },
              { duration: "eighth", id: "e5", notes: [{ step: "G", octave: 5 }] },
              { duration: "eighth", id: "e6", notes: [{ step: "A", octave: 5 }] },
              { duration: "eighth", id: "e7", notes: [{ step: "B", octave: 5 }] },
              { duration: "eighth", id: "e8", notes: [{ step: "C", octave: 6 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const SixteenNoteSlur: StoryObj = {
  name: "Sixteen-note slur across a full measure",
  render: () => {
    const steps = ["C", "D", "E", "F", "G", "A", "B", "C", "D", "E", "F", "G", "A", "B", "C", "D"];
    const octs = [5, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 7, 7];
    const voice = steps.map((s, i) => {
      const ev: Record<string, unknown> = {
        duration: "16th",
        id: `s${i + 1}`,
        notes: [{ step: s, octave: octs[i] }],
      };
      if (i === 0) ev.slurs = [{ target: `s16` }];
      return ev;
    });
    const mnx = buildMnx({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      measures: [{ time: { count: 4, unit: 4 }, voices: [voice as any] }],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

// ───────────────────────────────────────────────────────────────
// Forced side
// ───────────────────────────────────────────────────────────────

export const ForcedAbove: StoryObj = {
  name: "Slur forced above",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                duration: "quarter",
                id: "u1",
                notes: [{ step: "C", octave: 4 }],
                slurs: [{ target: "u4", side: "up" }],
              },
              { duration: "quarter", id: "u2", notes: [{ step: "D", octave: 4 }] },
              { duration: "quarter", id: "u3", notes: [{ step: "E", octave: 4 }] },
              { duration: "quarter", id: "u4", notes: [{ step: "F", octave: 4 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const ForcedBelow: StoryObj = {
  name: "Slur forced below",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                duration: "quarter",
                id: "b1",
                notes: [{ step: "B", octave: 5 }],
                slurs: [{ target: "b4", side: "down" }],
              },
              { duration: "quarter", id: "b2", notes: [{ step: "A", octave: 5 }] },
              { duration: "quarter", id: "b3", notes: [{ step: "G", octave: 5 }] },
              { duration: "quarter", id: "b4", notes: [{ step: "F", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

// ───────────────────────────────────────────────────────────────
// Pitch register / staff position
// ───────────────────────────────────────────────────────────────

export const AllOnStaffLines: StoryObj = {
  name: "Notes on staff lines (E G B D F)",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", id: "li1", notes: [{ step: "E", octave: 4 }], slurs: [{ target: "li5" }] },
              { duration: "quarter", id: "li2", notes: [{ step: "G", octave: 4 }] },
              { duration: "quarter", id: "li3", notes: [{ step: "B", octave: 4 }] },
              { duration: "quarter", id: "li4", notes: [{ step: "D", octave: 5 }] },
            ],
          ],
        },
        {
          voices: [[{ duration: "whole", id: "li5", notes: [{ step: "F", octave: 5 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const AllInSpaces: StoryObj = {
  name: "Notes in staff spaces (F A C E)",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", id: "sp1", notes: [{ step: "F", octave: 4 }], slurs: [{ target: "sp4" }] },
              { duration: "quarter", id: "sp2", notes: [{ step: "A", octave: 4 }] },
              { duration: "quarter", id: "sp3", notes: [{ step: "C", octave: 5 }] },
              { duration: "quarter", id: "sp4", notes: [{ step: "E", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const HighLedgerLines: StoryObj = {
  name: "High ledger-line notes",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", id: "hl1", notes: [{ step: "A", octave: 6 }], slurs: [{ target: "hl4" }] },
              { duration: "quarter", id: "hl2", notes: [{ step: "C", octave: 7 }] },
              { duration: "quarter", id: "hl3", notes: [{ step: "E", octave: 7 }] },
              { duration: "quarter", id: "hl4", notes: [{ step: "G", octave: 7 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const LowLedgerLines: StoryObj = {
  name: "Low ledger-line notes",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", id: "ll1", notes: [{ step: "C", octave: 4 }], slurs: [{ target: "ll4" }] },
              { duration: "quarter", id: "ll2", notes: [{ step: "A", octave: 3 }] },
              { duration: "quarter", id: "ll3", notes: [{ step: "F", octave: 3 }] },
              { duration: "quarter", id: "ll4", notes: [{ step: "D", octave: 3 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const TightSpacing: StoryObj = {
  name: "Closely spaced two-note slurs",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "eighth", id: "ts1", notes: [{ step: "E", octave: 5 }], slurs: [{ target: "ts2" }] },
              { duration: "eighth", id: "ts2", notes: [{ step: "D", octave: 5 }] },
              { duration: "eighth", id: "ts3", notes: [{ step: "C", octave: 5 }], slurs: [{ target: "ts4" }] },
              { duration: "eighth", id: "ts4", notes: [{ step: "B", octave: 4 }] },
              { duration: "eighth", id: "ts5", notes: [{ step: "A", octave: 4 }], slurs: [{ target: "ts6" }] },
              { duration: "eighth", id: "ts6", notes: [{ step: "G", octave: 4 }] },
              { duration: "eighth", id: "ts7", notes: [{ step: "F", octave: 4 }], slurs: [{ target: "ts8" }] },
              { duration: "eighth", id: "ts8", notes: [{ step: "E", octave: 4 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

// ───────────────────────────────────────────────────────────────
// Note types
// ───────────────────────────────────────────────────────────────

export const SlurWithChords: StoryObj = {
  name: "Slur over chords",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                duration: "quarter",
                id: "ch1",
                notes: [
                  { step: "C", octave: 5 },
                  { step: "E", octave: 5 },
                  { step: "G", octave: 5 },
                ],
                slurs: [{ target: "ch4" }],
              },
              {
                duration: "quarter",
                id: "ch2",
                notes: [
                  { step: "D", octave: 5 },
                  { step: "F", octave: 5 },
                  { step: "A", octave: 5 },
                ],
              },
              {
                duration: "quarter",
                id: "ch3",
                notes: [
                  { step: "E", octave: 5 },
                  { step: "G", octave: 5 },
                  { step: "B", octave: 5 },
                ],
              },
              {
                duration: "quarter",
                id: "ch4",
                notes: [
                  { step: "F", octave: 5 },
                  { step: "A", octave: 5 },
                  { step: "C", octave: 6 },
                ],
              },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const DottedNotes: StoryObj = {
  name: "Slur over dotted notes",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                duration: "quarter",
                dots: 1,
                id: "do1",
                notes: [{ step: "C", octave: 5 }],
                slurs: [{ target: "do4" }],
              },
              { duration: "eighth", id: "do2", notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", dots: 1, id: "do3", notes: [{ step: "E", octave: 5 }] },
              { duration: "eighth", id: "do4", notes: [{ step: "F", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const SlurEndOnDottedNote: StoryObj = {
  name: "Slur ending at a dotted notehead",
  render: () => {
    // The slur terminates on a dotted note. Standard engraving practice ends
    // the slur at the notehead — the augmentation dot sits clear of the curve
    // in its own staff space and must NOT pull the endpoint rightward past it.
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "eighth", id: "se1", notes: [{ step: "C", octave: 5 }], slurs: [{ target: "se2" }] },
              { duration: "half", dots: 1, id: "se2", notes: [{ step: "E", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const MixedDurations: StoryObj = {
  name: "Slur over mixed durations",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "half", id: "mx1", notes: [{ step: "C", octave: 5 }], slurs: [{ target: "mx5" }] },
              { duration: "quarter", id: "mx2", notes: [{ step: "D", octave: 5 }] },
              { duration: "eighth", id: "mx3", notes: [{ step: "E", octave: 5 }] },
              { duration: "eighth", id: "mx4", notes: [{ step: "F", octave: 5 }] },
            ],
          ],
        },
        {
          voices: [[{ duration: "whole", id: "mx5", notes: [{ step: "G", octave: 5 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const SlurOverRest: StoryObj = {
  name: "Slur over a rest",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", id: "or1", notes: [{ step: "C", octave: 5 }], slurs: [{ target: "or4" }] },
              { duration: "quarter", id: "or2", notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", id: "or3", rest: true },
              { duration: "quarter", id: "or4", notes: [{ step: "E", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

// ───────────────────────────────────────────────────────────────
// Articulations (inside the slur, per
// ───────────────────────────────────────────────────────────────

export const WithStaccato: StoryObj = {
  name: "Slur with staccato marks",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                duration: "quarter",
                id: "st1",
                notes: [{ step: "C", octave: 5 }],
                slurs: [{ target: "st4" }],
                markings: { staccato: {} },
              },
              { duration: "quarter", id: "st2", notes: [{ step: "D", octave: 5 }], markings: { staccato: {} } },
              { duration: "quarter", id: "st3", notes: [{ step: "E", octave: 5 }], markings: { staccato: {} } },
              { duration: "quarter", id: "st4", notes: [{ step: "F", octave: 5 }], markings: { staccato: {} } },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const WithAccent: StoryObj = {
  name: "Accents at slur endpoints",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                duration: "quarter",
                id: "ac1",
                notes: [{ step: "C", octave: 5 }],
                slurs: [{ target: "ac4" }],
                markings: { accent: {} },
              },
              { duration: "quarter", id: "ac2", notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", id: "ac3", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", id: "ac4", notes: [{ step: "F", octave: 5 }], markings: { accent: {} } },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const WithMarcato: StoryObj = {
  name: "Slur with marcato marks",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                duration: "quarter",
                id: "ma1",
                notes: [{ step: "C", octave: 5 }],
                slurs: [{ target: "ma4" }],
                markings: { strongAccent: {} },
              },
              { duration: "quarter", id: "ma2", notes: [{ step: "D", octave: 5 }], markings: { strongAccent: {} } },
              { duration: "quarter", id: "ma3", notes: [{ step: "E", octave: 5 }], markings: { strongAccent: {} } },
              { duration: "quarter", id: "ma4", notes: [{ step: "F", octave: 5 }], markings: { strongAccent: {} } },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const MixedArticulations: StoryObj = {
  name: "Mixed staccato and accent marks",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                duration: "quarter",
                id: "mi1",
                notes: [{ step: "C", octave: 5 }],
                slurs: [{ target: "mi4" }],
                markings: { accent: {} },
              },
              { duration: "quarter", id: "mi2", notes: [{ step: "D", octave: 5 }], markings: { staccato: {} } },
              { duration: "quarter", id: "mi3", notes: [{ step: "E", octave: 5 }], markings: { staccato: {} } },
              { duration: "quarter", id: "mi4", notes: [{ step: "F", octave: 5 }], markings: { accent: {} } },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

//: "Only tenuto lines and staccato marks may go inside the
// first and last notes of a slur." Tenuto on every note — boundary tenutos
// should sit INSIDE the slur arc (not outside like accents).
export const WithTenuto: StoryObj = {
  name: "Tenuto marks inside the slur",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                duration: "quarter",
                id: "tn1",
                notes: [{ step: "C", octave: 5 }],
                slurs: [{ target: "tn4" }],
                markings: { tenuto: {} },
              },
              { duration: "quarter", id: "tn2", notes: [{ step: "D", octave: 5 }], markings: { tenuto: {} } },
              { duration: "quarter", id: "tn3", notes: [{ step: "E", octave: 5 }], markings: { tenuto: {} } },
              { duration: "quarter", id: "tn4", notes: [{ step: "F", octave: 5 }], markings: { tenuto: {} } },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

// Staccatissimo wedges follow the tall-articulation slur rule: boundary
// wedges sit outside the curve, while interior wedges sit between curve and
// staff. Their ink remains wholly outside the staff in both roles.
export const WithStaccatissimoWedge: StoryObj = {
  name: "Staccatissimo wedges at boundaries and inside",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                duration: "quarter",
                id: "sw1",
                notes: [{ step: "C", octave: 5 }],
                slurs: [{ target: "sw4" }],
                markings: { _x: { viritura: { staccatissimoWedge: {} } } },
              },
              {
                duration: "quarter",
                id: "sw2",
                notes: [{ step: "D", octave: 5 }],
                markings: { _x: { viritura: { staccatissimoWedge: {} } } },
              },
              {
                duration: "quarter",
                id: "sw3",
                notes: [{ step: "E", octave: 5 }],
                markings: { _x: { viritura: { staccatissimoWedge: {} } } },
              },
              {
                duration: "quarter",
                id: "sw4",
                notes: [{ step: "F", octave: 5 }],
                markings: { _x: { viritura: { staccatissimoWedge: {} } } },
              },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

//: "When notes within a slur have mixed stem direction,
// place articulation marks beside each notehead, even though the slur is
// above the stave." Slur spans low-stem-up + high-stem-down notes; each
// articulation should attach to its own notehead, not all sit above the slur.
export const MixedStemSlurArticulations: StoryObj = {
  name: "Articulations beside mixed-direction stems",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                duration: "quarter",
                id: "ms1",
                notes: [{ step: "E", octave: 4 }],
                slurs: [{ target: "ms4" }],
                markings: { staccato: {} },
              },
              { duration: "quarter", id: "ms2", notes: [{ step: "A", octave: 5 }], markings: { staccato: {} } },
              { duration: "quarter", id: "ms3", notes: [{ step: "F", octave: 4 }], markings: { staccato: {} } },
              { duration: "quarter", id: "ms4", notes: [{ step: "B", octave: 5 }], markings: { staccato: {} } },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

//: "An exception is when [outside placement] would otherwise
// be too far from a note to be immediately apparent." When the slur is
// pulled far from the notehead by a tall context (here: very high inner
// note forces a tall slur arc), the boundary accent should sit inside the
// slur rather than way above it.
export const AccentInTallSlurException: StoryObj = {
  name: "Accent inside a tall slur",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                duration: "quarter",
                id: "tx1",
                notes: [{ step: "C", octave: 4 }],
                slurs: [{ target: "tx4" }],
                markings: { accent: {} },
              },
              { duration: "quarter", id: "tx2", notes: [{ step: "A", octave: 5 }] },
              { duration: "quarter", id: "tx3", notes: [{ step: "B", octave: 5 }] },
              { duration: "quarter", id: "tx4", notes: [{ step: "C", octave: 4 }], markings: { accent: {} } },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

//: "Centre a slur on a stem. With the addition of a tenuto
// line between the slur and a stem, centre the slur, like the tenuto line,
// on the notehead (when there is a staccato dot, the slur centres on the
// stem)." Two-note slur with tenuto on each note — slur should centre on
// noteheads, not on stems.
export const TenutoCentersSlur: StoryObj = {
  name: "Tenuto centers the slur on the notehead",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                duration: "quarter",
                id: "tc1",
                notes: [{ step: "G", octave: 4 }],
                slurs: [{ target: "tc2" }],
                markings: { tenuto: {} },
              },
              { duration: "quarter", id: "tc2", notes: [{ step: "G", octave: 4 }], markings: { tenuto: {} } },
              {
                duration: "quarter",
                id: "tc3",
                notes: [{ step: "G", octave: 4 }],
                slurs: [{ target: "tc4" }],
                markings: { tenuto: {}, staccato: {} },
              },
              {
                duration: "quarter",
                id: "tc4",
                notes: [{ step: "G", octave: 4 }],
                markings: { tenuto: {}, staccato: {} },
              },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

//: "To show a slur between two consecutive notes of the same
// pitch, place articulation between slur and noteheads [→ both notes
// rearticulated]. When articulation is placed outside the slur on either or
// both of the two notes, the slur becomes a tie."
// Three two-note pairs of repeated G4: (1) plain rearticulation via staccato
// inside the slur, (2) tenuto inside, (3) accent outside — last reads as
// a tie even though notated as a slur.
export const SamePitchRearticulation: StoryObj = {
  name: "Same-pitch rearticulation and tie-like slurs",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 6, unit: 4 },
          voices: [
            [
              {
                duration: "quarter",
                id: "sp1",
                notes: [{ step: "G", octave: 4 }],
                slurs: [{ target: "sp2" }],
                markings: { staccato: {} },
              },
              { duration: "quarter", id: "sp2", notes: [{ step: "G", octave: 4 }], markings: { staccato: {} } },
              {
                duration: "quarter",
                id: "sp3",
                notes: [{ step: "G", octave: 4 }],
                slurs: [{ target: "sp4" }],
                markings: { tenuto: {} },
              },
              { duration: "quarter", id: "sp4", notes: [{ step: "G", octave: 4 }], markings: { tenuto: {} } },
              {
                duration: "quarter",
                id: "sp5",
                notes: [{ step: "G", octave: 4 }],
                slurs: [{ target: "sp6" }],
                markings: { accent: {} },
              },
              { duration: "quarter", id: "sp6", notes: [{ step: "G", octave: 4 }], markings: { accent: {} } },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

//: "Within the stave, place articulation marks in the first
// clear stave-space beyond the end of the stem." Two stem-up notes with
// articulations; the mark must sit in the first clear space past the stem
// tip, not floating outside the staff when there is still a free space.
export const ArticulationInFirstClearSpace: StoryObj = {
  name: "Articulation in the first clear staff space",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              // Low notes, stems up — staccato should sit just past the stem tip
              // inside the staff, not above the top staff line.
              { duration: "quarter", id: "fc1", notes: [{ step: "E", octave: 4 }], markings: { staccato: {} } },
              { duration: "quarter", id: "fc2", notes: [{ step: "F", octave: 4 }], markings: { staccato: {} } },
              { duration: "quarter", id: "fc3", notes: [{ step: "G", octave: 4 }], markings: { staccato: {} } },
              { duration: "quarter", id: "fc4", notes: [{ step: "A", octave: 4 }], markings: { staccato: {} } },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

// ───────────────────────────────────────────────────────────────
// Nesting and overlap
// ───────────────────────────────────────────────────────────────

export const NestedSlurs: StoryObj = {
  name: "Four-note slur with a nested two-note slur",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", id: "ne1", notes: [{ step: "C", octave: 5 }], slurs: [{ target: "ne4" }] },
              { duration: "quarter", id: "ne2", notes: [{ step: "D", octave: 5 }], slurs: [{ target: "ne3" }] },
              { duration: "quarter", id: "ne3", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", id: "ne4", notes: [{ step: "F", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const ChainedPairs: StoryObj = {
  name: "Chained two-note slurs",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", id: "cp1", notes: [{ step: "C", octave: 5 }], slurs: [{ target: "cp2" }] },
              { duration: "quarter", id: "cp2", notes: [{ step: "D", octave: 5 }], slurs: [{ target: "cp3" }] },
              { duration: "quarter", id: "cp3", notes: [{ step: "E", octave: 5 }], slurs: [{ target: "cp4" }] },
              { duration: "quarter", id: "cp4", notes: [{ step: "F", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const MultipleSlursInMeasure: StoryObj = {
  name: "Multiple short slurs in one measure",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "eighth", id: "ms1", notes: [{ step: "C", octave: 5 }], slurs: [{ target: "ms2" }] },
              { duration: "eighth", id: "ms2", notes: [{ step: "E", octave: 5 }] },
              { duration: "eighth", id: "ms3", notes: [{ step: "G", octave: 5 }], slurs: [{ target: "ms4" }] },
              { duration: "eighth", id: "ms4", notes: [{ step: "E", octave: 5 }] },
              { duration: "eighth", id: "ms5", notes: [{ step: "C", octave: 5 }], slurs: [{ target: "ms6" }] },
              { duration: "eighth", id: "ms6", notes: [{ step: "E", octave: 5 }] },
              { duration: "eighth", id: "ms7", notes: [{ step: "G", octave: 5 }], slurs: [{ target: "ms8" }] },
              { duration: "eighth", id: "ms8", notes: [{ step: "C", octave: 6 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

// ───────────────────────────────────────────────────────────────
// Cross-barline / phrase
// ───────────────────────────────────────────────────────────────

export const PhraseAcrossThreeMeasures: StoryObj = {
  name: "Phrase slur across three measures",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", id: "p1", notes: [{ step: "C", octave: 5 }], slurs: [{ target: "p12" }] },
              { duration: "quarter", id: "p2", notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", id: "p3", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", id: "p4", notes: [{ step: "F", octave: 5 }] },
            ],
          ],
        },
        {
          voices: [
            [
              { duration: "quarter", id: "p5", notes: [{ step: "G", octave: 5 }] },
              { duration: "quarter", id: "p6", notes: [{ step: "A", octave: 5 }] },
              { duration: "quarter", id: "p7", notes: [{ step: "B", octave: 5 }] },
              { duration: "quarter", id: "p8", notes: [{ step: "C", octave: 6 }] },
            ],
          ],
        },
        {
          voices: [
            [
              { duration: "quarter", id: "p9", notes: [{ step: "B", octave: 5 }] },
              { duration: "quarter", id: "p10", notes: [{ step: "A", octave: 5 }] },
              { duration: "quarter", id: "p11", notes: [{ step: "G", octave: 5 }] },
              { duration: "quarter", id: "p12", notes: [{ step: "F", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

// ───────────────────────────────────────────────────────────────
// Combined stress test
// ───────────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────────
//specific cases (re-read May 2026)
// ───────────────────────────────────────────────────────────────

export const MixedStemDirections: StoryObj = {
  name: "Mixed stem directions place the slur above",
  render: () => {
    // Notes straddle middle line so stem directions alternate. Per
    // the slur should default above the stave, not below.
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", id: "ms1", notes: [{ step: "A", octave: 4 }], slurs: [{ target: "ms4" }] },
              { duration: "quarter", id: "ms2", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", id: "ms3", notes: [{ step: "B", octave: 4 }] },
              { duration: "quarter", id: "ms4", notes: [{ step: "F", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const OppositeOuterStems: StoryObj = {
  name: "Slur between opposite outer stems",
  render: () => {
    // First note high (stem down), last note low (stem up). Per
    // the slur should tilt with the pitches, not contrary to them.
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", id: "op1", notes: [{ step: "B", octave: 5 }], slurs: [{ target: "op4" }] },
              { duration: "quarter", id: "op2", notes: [{ step: "G", octave: 5 }] },
              { duration: "quarter", id: "op3", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", id: "op4", notes: [{ step: "C", octave: 4 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const SlurOverBeamedGroup: StoryObj = {
  name: "Slur on the beam side clears the beam",
  render: () => {
    // High notes get stems DOWN, so the beam sits BELOW the noteheads.
    // Forcing slur side="down" puts it on the same side as the beam so
    // the engraver must lift the slur to clear the beam (G-J). Without
    // an explicit side the default would be above (opposite the stems),
    // which wouldn't exercise this rule at all.
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                duration: "eighth",
                id: "bg1",
                notes: [{ step: "C", octave: 5 }],
                slurs: [{ target: "bg4", side: "down" }],
              },
              { duration: "eighth", id: "bg2", notes: [{ step: "D", octave: 5 }] },
              { duration: "eighth", id: "bg3", notes: [{ step: "E", octave: 5 }] },
              { duration: "eighth", id: "bg4", notes: [{ step: "F", octave: 5 }] },
              {
                duration: "eighth",
                id: "bg5",
                notes: [{ step: "G", octave: 5 }],
                slurs: [{ target: "bg8", side: "down" }],
              },
              { duration: "eighth", id: "bg6", notes: [{ step: "F", octave: 5 }] },
              { duration: "eighth", id: "bg7", notes: [{ step: "E", octave: 5 }] },
              { duration: "eighth", id: "bg8", notes: [{ step: "D", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const SlurEndsOnTiedNote: StoryObj = {
  name: "Slur starts beside an outgoing tie",
  render: () => {
    // First note is tied to next; slur starts on the tied pair. Tip must
    // shift outward enough to clear the tie at the notehead.
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                duration: "quarter",
                id: "tn1",
                notes: [{ step: "C", octave: 5 }],
                ties: [{ target: "tn2" }],
                slurs: [{ target: "tn4" }],
              },
              { duration: "quarter", id: "tn2", notes: [{ step: "C", octave: 5 }] },
              { duration: "quarter", id: "tn3", notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", id: "tn4", notes: [{ step: "E", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const SlurEndsOnIncomingTie: StoryObj = {
  name: "Slur ends beside an incoming tie",
  render: () => {
    // Slur target it3 is the RECEIVING end of a tie from it2 (same pitch).
    // The slur's right tip must clear the incoming tie's right endpoint at
    // the notehead. (Pre-fix: it3 had an OUTGOING tie which was the wrong
    // direction for testing this rule.)
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", id: "it1", notes: [{ step: "C", octave: 5 }], slurs: [{ target: "it3" }] },
              { duration: "quarter", id: "it2", notes: [{ step: "E", octave: 5 }], ties: [{ target: "it3" }] },
              { duration: "quarter", id: "it3", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", id: "it4", notes: [{ step: "F", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const ClusterChordSlur: StoryObj = {
  name: "Slur anchors to offset noteheads in cluster chords",
  render: () => {
    // Chord with a major second forces one notehead to the opposite side of
    // the stem. Perthe slur should centre on the notehead on
    // the *correct* side of the stem.
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                duration: "quarter",
                id: "cl1",
                notes: [
                  { step: "C", octave: 5 },
                  { step: "D", octave: 5 },
                ],
                slurs: [{ target: "cl4" }],
              },
              {
                duration: "quarter",
                id: "cl2",
                notes: [
                  { step: "D", octave: 5 },
                  { step: "E", octave: 5 },
                ],
              },
              {
                duration: "quarter",
                id: "cl3",
                notes: [
                  { step: "E", octave: 5 },
                  { step: "F", octave: 5 },
                ],
              },
              {
                duration: "quarter",
                id: "cl4",
                notes: [
                  { step: "F", octave: 5 },
                  { step: "G", octave: 5 },
                ],
              },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const ApexOnStaffSpace: StoryObj = {
  name: "Slur apex lands in a staff space",
  render: () => {
    // Span and pitches chosen so a naive bezier apex would land on the
    // middle staff line; the engraver should nudge into the space above.
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", id: "ap1", notes: [{ step: "D", octave: 5 }], slurs: [{ target: "ap4" }] },
              { duration: "quarter", id: "ap2", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", id: "ap3", notes: [{ step: "F", octave: 5 }] },
              { duration: "quarter", id: "ap4", notes: [{ step: "D", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const LongSlurPlateau: StoryObj = {
  name: "Long slur flattens through the middle",
  render: () => {
    // Wide span across 3 measures — perthe curve should
    // flatten in the middle rather than arch up dramatically.
    const measures = [
      {
        time: { count: 4, unit: 4 },
        voices: [
          [
            { duration: "quarter", id: "lp1", notes: [{ step: "C", octave: 5 }], slurs: [{ target: "lp12" }] },
            { duration: "quarter", id: "lp2", notes: [{ step: "D", octave: 5 }] },
            { duration: "quarter", id: "lp3", notes: [{ step: "E", octave: 5 }] },
            { duration: "quarter", id: "lp4", notes: [{ step: "F", octave: 5 }] },
          ],
        ],
      },
      {
        voices: [
          [
            { duration: "quarter", id: "lp5", notes: [{ step: "G", octave: 5 }] },
            { duration: "quarter", id: "lp6", notes: [{ step: "A", octave: 5 }] },
            { duration: "quarter", id: "lp7", notes: [{ step: "G", octave: 5 }] },
            { duration: "quarter", id: "lp8", notes: [{ step: "F", octave: 5 }] },
          ],
        ],
      },
      {
        voices: [
          [
            { duration: "quarter", id: "lp9", notes: [{ step: "E", octave: 5 }] },
            { duration: "quarter", id: "lp10", notes: [{ step: "D", octave: 5 }] },
            { duration: "quarter", id: "lp11", notes: [{ step: "C", octave: 5 }] },
            { duration: "quarter", id: "lp12", notes: [{ step: "C", octave: 5 }] },
          ],
        ],
      },
    ];
    const mnx = buildMnx({ measures });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const SymmetricSlur: StoryObj = {
  name: "Symmetric slur between matching outer pitches",
  render: () => {
    // Per— when outer pitches match, the slur is symmetric.
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", id: "sy1", notes: [{ step: "E", octave: 5 }], slurs: [{ target: "sy4" }] },
              { duration: "quarter", id: "sy2", notes: [{ step: "G", octave: 5 }] },
              { duration: "quarter", id: "sy3", notes: [{ step: "F", octave: 5 }] },
              { duration: "quarter", id: "sy4", notes: [{ step: "E", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const PhraseSlurOverArticulationSlurs: StoryObj = {
  name: "Phrase slur outside nested articulation slurs",
  render: () => {
    // Outer 8-note phrase slur containing two 2-note articulation slurs.
    // Perthe inner (shorter) slurs sit closer to the notes.
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                duration: "eighth",
                id: "ph1",
                notes: [{ step: "C", octave: 5 }],
                slurs: [{ target: "ph8" }, { target: "ph2" }],
              },
              { duration: "eighth", id: "ph2", notes: [{ step: "D", octave: 5 }] },
              { duration: "eighth", id: "ph3", notes: [{ step: "E", octave: 5 }], slurs: [{ target: "ph4" }] },
              { duration: "eighth", id: "ph4", notes: [{ step: "F", octave: 5 }] },
              { duration: "eighth", id: "ph5", notes: [{ step: "G", octave: 5 }], slurs: [{ target: "ph6" }] },
              { duration: "eighth", id: "ph6", notes: [{ step: "A", octave: 5 }] },
              { duration: "eighth", id: "ph7", notes: [{ step: "G", octave: 5 }], slurs: [{ target: "ph8" }] },
              { duration: "eighth", id: "ph8", notes: [{ step: "F", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const StressGrid: StoryObj = {
  name: "Varied slur directions and repeated pitches",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "eighth", id: "sg1", notes: [{ step: "C", octave: 5 }], slurs: [{ target: "sg2" }] },
              { duration: "eighth", id: "sg2", notes: [{ step: "G", octave: 5 }] },
              { duration: "eighth", id: "sg3", notes: [{ step: "F", octave: 5 }], slurs: [{ target: "sg4" }] },
              { duration: "eighth", id: "sg4", notes: [{ step: "B", octave: 4 }] },
              { duration: "eighth", id: "sg5", notes: [{ step: "A", octave: 4 }], slurs: [{ target: "sg6" }] },
              { duration: "eighth", id: "sg6", notes: [{ step: "E", octave: 5 }] },
              { duration: "eighth", id: "sg7", notes: [{ step: "D", octave: 5 }], slurs: [{ target: "sg8" }] },
              { duration: "eighth", id: "sg8", notes: [{ step: "G", octave: 4 }] },
            ],
          ],
        },
        {
          voices: [
            [
              { duration: "eighth", id: "sg9", notes: [{ step: "C", octave: 5 }], slurs: [{ target: "sg10" }] },
              { duration: "eighth", id: "sg10", notes: [{ step: "C", octave: 5 }] },
              { duration: "eighth", id: "sg11", notes: [{ step: "E", octave: 5 }], slurs: [{ target: "sg12" }] },
              { duration: "eighth", id: "sg12", notes: [{ step: "E", octave: 5 }] },
              { duration: "eighth", id: "sg13", notes: [{ step: "G", octave: 5 }], slurs: [{ target: "sg14" }] },
              { duration: "eighth", id: "sg14", notes: [{ step: "G", octave: 5 }] },
              { duration: "eighth", id: "sg15", notes: [{ step: "C", octave: 6 }], slurs: [{ target: "sg16" }] },
              { duration: "eighth", id: "sg16", notes: [{ step: "C", octave: 6 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};
