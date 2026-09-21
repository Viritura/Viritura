import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Engraving Behavior/Dynamics & Hairpins/Dynamic Placement",
  component: ScorePreview,
};

export default meta;

export const CenteredOnNoteheadByDuration: StoryObj = {
  render: () => {
    // Each measure carries the same fp, but the first note has a different
    // notehead width per measure. The dynamic must stay optically centred on
    // the actual notehead in every case — whole noteheads are wider than
    // black noteheads, so a fixed-width assumption would shift the dynamic
    // left under the longer notes.
    const dflat = { step: "D", octave: 4, alter: -1 } as const;
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [[{ duration: "whole", notes: [dflat] }]],
          dynamics: [{ value: "fp", position: { fraction: [0, 1] } }],
        },
        {
          voices: [
            [
              { duration: "half", notes: [dflat] },
              { duration: "half", notes: [dflat] },
            ],
          ],
          dynamics: [{ value: "fp", position: { fraction: [0, 1] } }],
        },
        {
          voices: [
            [
              { duration: "quarter", notes: [dflat] },
              { duration: "quarter", notes: [dflat] },
              { duration: "quarter", notes: [dflat] },
              { duration: "quarter", notes: [dflat] },
            ],
          ],
          dynamics: [{ value: "fp", position: { fraction: [0, 1] } }],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Centered on noteheads by duration",
};

export const ClearsAccentArticulation: StoryObj = {
  render: () => {
    // A stem-up chord places its accent below the noteheads, exactly where a
    // below-staff dynamic wants to sit. The dynamic must be pushed down to
    // clear the articulation (modelled on Rhapsody in Blue m40, Violin II).
    // The right-hand measure drops the accent for comparison: the un-accented
    // `p` sits closer to the staff.
    const chord = [{ step: "C", octave: 4, alter: 1 } as const, { step: "A", octave: 3 } as const];
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", notes: chord, markings: { accent: {} } },
              { duration: "quarter", rest: true },
              { duration: "half", rest: true },
            ],
          ],
          dynamics: [{ value: "p", position: { fraction: [0, 1] } }],
        },
        {
          voices: [
            [
              { duration: "quarter", notes: chord },
              { duration: "quarter", rest: true },
              { duration: "half", rest: true },
            ],
          ],
          dynamics: [{ value: "p", position: { fraction: [0, 1] } }],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Clears accent articulation",
};

/**
 * Multi-staff dynamics can occupy the space shared by two staves. The `mf`
 * and crescendo explicitly request that shared placement, while the `p`
 * leaves `staff` unset so MNX automatic staff ownership selects its staff.
 */
export const BetweenStavesAndAutomaticOwnership: StoryObj = {
  render: () => {
    const mnx = JSON.stringify(
      {
        mnx: { version: 1 },
        global: {
          measures: [{ id: "m1", time: { count: 4, unit: 4 } }],
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
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 3 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "D", octave: 3 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "E", octave: 3 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "F", octave: 3 } }] },
                    ],
                  },
                ],
                dynamics: [
                  {
                    id: "between-mf",
                    type: "immediate",
                    value: "mf",
                    orient: "between",
                    staff: 1,
                    position: { fraction: [0, 1] },
                  },
                  {
                    id: "between-crescendo",
                    type: "gradual",
                    orient: "between",
                    staff: 1,
                    position: { fraction: [1, 4] },
                    end: { measure: "m1", position: { fraction: [3, 4] } },
                    wedgeType: "increasing",
                  },
                  {
                    id: "automatic-staff-p",
                    type: "immediate",
                    value: "p",
                    position: { fraction: [3, 4] },
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
    return <ScorePreview mnxJson={mnx} height={500} />;
  },
  name: "Between staves and automatic staff ownership",
};
