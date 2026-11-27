import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "MNX Spec/Notes/Notehead Shapes",
  component: ScorePreview,
};
export default meta;

const shapes = ["circled", "slashed", "backSlashed"] as const;
const durations = [["quarter", "quarter", "quarter", "quarter"], ["half", "half"], ["whole"], ["breve"]];
const mnx = JSON.stringify({
  mnx: { version: 1 },
  global: { measures: [{ time: { count: 4, unit: 4 } }, {}, {}, { time: { count: 4, unit: 2 } }] },
  parts: shapes.map((shape) => ({
    id: shape,
    name: shape,
    measures: durations.map((measure) => ({
      sequences: [
        {
          content: measure.map((base) => ({
            duration: { base },
            notes: [{ pitch: { step: "B", octave: 4 }, notehead: { shape } }],
          })),
        },
      ],
    })),
  })),
});

export const CircledAndSlashed: StoryObj = { args: { mnxJson: mnx } };
