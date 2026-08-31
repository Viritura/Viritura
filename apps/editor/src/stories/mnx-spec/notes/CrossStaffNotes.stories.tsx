import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "MNX Spec/Notes & Rests/Cross-Staff Notes",
  component: ScorePreview,
};

export default meta;

/**
 * Grand-staff cross-staff sample.
 *
 * Measure 1: A beamed eighth-note arpeggio in the LH (staff 2). The middle
 * notes set `event.staff = 1` so the noteheads render on the treble staff
 * while the beam spans both staves — the canonical pattern for cross-staff
 * keyboard writing (Bach, Schumann, Liszt). The RH (staff 1) holds chords.
 *
 * Measure 2: Quarter-note cross-staff alternation, where every other LH
 * event hops up to the treble staff. Demonstrates non-beamed cross-staff
 * positioning.
 */
function buildCrossStaffMnx(): string {
  return JSON.stringify(
    {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }, {}],
      },
      parts: [
        {
          name: "Piano",
          staves: 2,
          measures: [
            {
              clefs: [
                { clef: { sign: "G", staffPosition: -2 }, staff: 1 },
                { clef: { sign: "F", staffPosition: 2 }, staff: 2 },
              ],
              beams: [{ events: ["ev1", "ev2", "ev3", "ev4"] }, { events: ["ev5", "ev6", "ev7", "ev8"] }],
              sequences: [
                {
                  staff: 1,
                  content: [
                    {
                      duration: { base: "half" },
                      notes: [{ pitch: { step: "G", octave: 4 } }, { pitch: { step: "B", octave: 4 } }],
                    },
                    {
                      duration: { base: "half" },
                      notes: [{ pitch: { step: "A", octave: 4 } }, { pitch: { step: "C", octave: 5 } }],
                    },
                  ],
                },
                {
                  staff: 2,
                  content: [
                    { id: "ev1", duration: { base: "eighth" }, notes: [{ pitch: { step: "C", octave: 3 } }] },
                    { id: "ev2", duration: { base: "eighth" }, notes: [{ pitch: { step: "G", octave: 3 } }] },
                    { id: "ev3", duration: { base: "eighth" }, staff: 1, notes: [{ pitch: { step: "C", octave: 4 } }] },
                    { id: "ev4", duration: { base: "eighth" }, staff: 1, notes: [{ pitch: { step: "E", octave: 4 } }] },
                    { id: "ev5", duration: { base: "eighth" }, staff: 1, notes: [{ pitch: { step: "G", octave: 4 } }] },
                    { id: "ev6", duration: { base: "eighth" }, staff: 1, notes: [{ pitch: { step: "E", octave: 4 } }] },
                    { id: "ev7", duration: { base: "eighth" }, notes: [{ pitch: { step: "G", octave: 3 } }] },
                    { id: "ev8", duration: { base: "eighth" }, notes: [{ pitch: { step: "C", octave: 3 } }] },
                  ],
                },
              ],
            },
            {
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
                    { duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 3 } }] },
                    {
                      duration: { base: "quarter" },
                      staff: 1,
                      notes: [{ pitch: { step: "E", octave: 4 } }],
                      id: "cross1",
                    },
                    { duration: { base: "quarter" }, notes: [{ pitch: { step: "G", octave: 3 } }] },
                    {
                      duration: { base: "quarter" },
                      staff: 1,
                      notes: [{ pitch: { step: "D", octave: 4 } }],
                      id: "cross2",
                    },
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
}

export const Default: StoryObj = {
  render: () => <ScorePreview mnxJson={buildCrossStaffMnx()} height={500} />,
};
