import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Viritura Extensions/Expressions & Labels/Tempo Swing",
  component: ScorePreview,
};
export default meta;

export const SwingAndStraight: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={buildMnx({
        measures: [
          {
            time: { count: 4, unit: 4 },
            voices: [[{ duration: "whole", notes: [{ step: "C", octave: 4 }] }]],
            virituraGlobal: {
              tempos: [
                {
                  bpm: 90,
                  value: { base: "quarter" },
                  text: [{ text: "Swung sixteenths" }],
                  swing: { mode: "swing", subdivision: "16th", ratio: [3, 2] },
                },
                { location: { fraction: [1, 2] }, text: [{ text: "Straight" }], swing: { mode: "straight" } },
              ],
            },
          },
        ],
      })}
    />
  ),
  name: "Quarter = 90 with swing, then a BPM-free Straight instruction",
};
