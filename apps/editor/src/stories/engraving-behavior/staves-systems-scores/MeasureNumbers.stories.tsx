import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Engraving Behavior/Staves, Systems & Scores/Measure Numbers",
  component: ScorePreview,
};

export default meta;

// House style: even when every bar carries an explicit `number` (as many
// MusicXML imports do), measure numbers are engraved only at the start of each
// system — never mid-system. Resize the preview to reflow the systems and watch
// the numbers track the new system openings.
export const HouseStyleSystemStartsOnly: StoryObj = {
  name: "Measure numbers at system starts",
  render: () => {
    const mnx = buildMnx({
      measures: Array.from({ length: 24 }, (_, i) => ({
        ...(i === 0 ? { time: { count: 4, unit: 4 } as const } : {}),
        number: i + 1,
        voices: [[{ duration: "whole" as const, notes: [{ step: "C", octave: 5 }] }]],
      })),
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};
