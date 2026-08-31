import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Engraving Behavior/Dynamics & Hairpins/Hairpin Clearance and Alignment",
  component: ScorePreview,
};

export default meta;

export const ClearsSlurInk: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          id: "m1",
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                id: "slur-source",
                duration: "quarter",
                notes: [{ step: "C", octave: 4 }],
                slurs: [{ target: "slur-target", side: "down" }],
              },
              { duration: "quarter", notes: [{ step: "D", octave: 4 }] },
              { id: "slur-target", duration: "quarter", notes: [{ step: "E", octave: 4 }] },
              { duration: "quarter", notes: [{ step: "F", octave: 4 }] },
            ],
          ],
          dynamics: [
            { id: "start-p", type: "immediate", position: { fraction: [0, 1] }, value: "p" },
            {
              id: "under-slur",
              type: "gradual",
              position: { fraction: [0, 1] },
              end: { measure: "m1", position: { fraction: [3, 4] } },
              wedgeType: "increasing",
            },
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Hairpin clears slur ink",
};

export const AlignedWithDynamics: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          id: "m1",
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "F", octave: 5 }] },
            ],
          ],
          dynamics: [
            { value: "p", position: { fraction: [0, 1] } },
            { value: "f", position: { fraction: [3, 4] } },
            {
              type: "gradual",
              position: { fraction: [0, 1] },
              end: { measure: "m1", position: { fraction: [3, 4] } },
              wedgeType: "increasing",
            },
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Aligned with dynamics (p < f)",
};
