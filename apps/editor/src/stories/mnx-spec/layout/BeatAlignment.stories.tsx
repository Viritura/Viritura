import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "Engraving Behavior/Rhythm & Spacing/Beat Alignment",
  component: ScorePreview,
};

export default meta;

/**
 * Two parts with different rhythmic densities (quarters vs eighths).
 * Beats at positions 0, 1, 2, 3 should be vertically aligned across staves.
 * Regression test for the merged LogSpacing cross-staff alignment fix.
 */
export const QuartersVsEighths: StoryObj = {
  render: () => {
    const mnx = JSON.stringify(
      {
        mnx: { version: 1 },
        layouts: [
          {
            id: "L1",
            content: [
              { type: "staff", sources: [{ part: "P1" }] },
              { type: "staff", sources: [{ part: "P2" }] },
            ],
          },
        ],
        scores: [{ name: "Score", layout: "L1" }],
        global: {
          measures: [{ time: { count: 4, unit: 4 } }, {}],
        },
        parts: [
          {
            id: "P1",
            name: "Flute",
            measures: [
              {
                clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
                sequences: [
                  {
                    content: [
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 5 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "D", octave: 5 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "E", octave: 5 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "F", octave: 5 } }] },
                    ],
                  },
                ],
              },
              {
                sequences: [
                  {
                    content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "G", octave: 5 } }] }],
                  },
                ],
              },
            ],
          },
          {
            id: "P2",
            name: "Oboe",
            measures: [
              {
                clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
                sequences: [
                  {
                    content: [
                      { duration: { base: "eighth" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
                      { duration: { base: "eighth" }, notes: [{ pitch: { step: "D", octave: 4 } }] },
                      { duration: { base: "eighth" }, notes: [{ pitch: { step: "E", octave: 4 } }] },
                      { duration: { base: "eighth" }, notes: [{ pitch: { step: "F", octave: 4 } }] },
                      { duration: { base: "eighth" }, notes: [{ pitch: { step: "G", octave: 4 } }] },
                      { duration: { base: "eighth" }, notes: [{ pitch: { step: "A", octave: 4 } }] },
                      { duration: { base: "eighth" }, notes: [{ pitch: { step: "B", octave: 4 } }] },
                      { duration: { base: "eighth" }, notes: [{ pitch: { step: "C", octave: 5 } }] },
                    ],
                  },
                ],
              },
              {
                sequences: [
                  {
                    content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "D", octave: 4 } }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
      null,
      2,
    );
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Quarter notes against eighth notes (two parts)",
};

/**
 * Three parts with whole notes, quarters, and sixteenths.
 * Extreme rhythmic density difference — alignment should still hold.
 */
export const WholeQuarterSixteenth: StoryObj = {
  render: () => {
    const mnx = JSON.stringify(
      {
        mnx: { version: 1 },
        layouts: [
          {
            id: "L1",
            content: [
              { type: "staff", sources: [{ part: "P1" }] },
              { type: "staff", sources: [{ part: "P2" }] },
              { type: "staff", sources: [{ part: "P3" }] },
            ],
          },
        ],
        scores: [{ name: "Score", layout: "L1" }],
        global: {
          measures: [{ time: { count: 4, unit: 4 } }],
        },
        parts: [
          {
            id: "P1",
            name: "Horn",
            measures: [
              {
                clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
                sequences: [
                  {
                    content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "G", octave: 4 } }] }],
                  },
                ],
              },
            ],
          },
          {
            id: "P2",
            name: "Violin",
            measures: [
              {
                clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
                sequences: [
                  {
                    content: [
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "A", octave: 5 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "B", octave: 5 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 6 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "D", octave: 6 } }] },
                    ],
                  },
                ],
              },
            ],
          },
          {
            id: "P3",
            name: "Piccolo",
            measures: [
              {
                clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
                sequences: [
                  {
                    content: Array.from({ length: 16 }, (_, i) => ({
                      duration: { base: "16th" },
                      notes: [{ pitch: { step: ["C", "D", "E", "F", "G", "A", "B"][i % 7], octave: 6 } }],
                    })),
                  },
                ],
              },
            ],
          },
        ],
      },
      null,
      2,
    );
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Whole, quarter, and sixteenth notes (three parts)",
};

/**
 * Grand staff (piano): treble has quarters, bass has eighths.
 * Beats should align between both staves of the same instrument.
 */
export const GrandStaffAlignment: StoryObj = {
  render: () => {
    const mnx = JSON.stringify(
      {
        mnx: { version: 1 },
        layouts: [
          {
            id: "L1",
            content: [
              { type: "staff", sources: [{ part: "P1", staff: 1 }] },
              { type: "staff", sources: [{ part: "P1", staff: 2 }] },
            ],
          },
        ],
        scores: [{ name: "Score", layout: "L1" }],
        global: {
          measures: [{ time: { count: 4, unit: 4 } }],
        },
        parts: [
          {
            id: "P1",
            name: "Piano",
            staves: 2,
            measures: [
              {
                clefs: [
                  { clef: { sign: "G", staffPosition: -2 }, staff: 1 },
                  { clef: { sign: "F", staffPosition: 2 }, staff: 2 },
                ],
                sequences: [
                  {
                    staff: 1,
                    content: [
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 5 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "D", octave: 5 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "E", octave: 5 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "F", octave: 5 } }] },
                    ],
                  },
                  {
                    staff: 2,
                    content: [
                      { duration: { base: "eighth" }, notes: [{ pitch: { step: "C", octave: 3 } }] },
                      { duration: { base: "eighth" }, notes: [{ pitch: { step: "D", octave: 3 } }] },
                      { duration: { base: "eighth" }, notes: [{ pitch: { step: "E", octave: 3 } }] },
                      { duration: { base: "eighth" }, notes: [{ pitch: { step: "F", octave: 3 } }] },
                      { duration: { base: "eighth" }, notes: [{ pitch: { step: "G", octave: 3 } }] },
                      { duration: { base: "eighth" }, notes: [{ pitch: { step: "A", octave: 3 } }] },
                      { duration: { base: "eighth" }, notes: [{ pitch: { step: "B", octave: 3 } }] },
                      { duration: { base: "eighth" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      null,
      2,
    );
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Piano grand staff with contrasting rhythms",
};
