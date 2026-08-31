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
