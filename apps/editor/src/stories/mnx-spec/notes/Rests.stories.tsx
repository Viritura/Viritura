import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Notes & Rests/Rests",
  component: ScorePreview,
};

export default meta;

/**
 * Full-measure rest with explicit staffPosition moves the rest glyph
 * vertically on the staff. Default position hangs from the 2nd line.
 */
export const FullMeasureRestStaffPosition: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
        },
        // Default position (no staffPosition)
        { fullMeasure: {} },
        // staffPosition: 2 -�� raised one space above default
        { fullMeasure: { staffPosition: 2 } },
        // staffPosition: -2 -�� lowered one space below middle line
        { fullMeasure: { staffPosition: -2 } },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Full-measure rests at different staff heights",
};
