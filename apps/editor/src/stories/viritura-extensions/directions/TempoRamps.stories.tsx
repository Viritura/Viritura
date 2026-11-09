import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Viritura Extensions/Expressions & Labels/Tempo Ramps",
  component: ScorePreview,
};
export default meta;

export const CurvesWithSystemText: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={buildMnx({
        measures: ["linear", "early", "late", "smooth"].map((curve, index) => ({
          id: `m${index}`,
          time: { count: 4, unit: 4 },
          tempos: [{ bpm: 100, value: { base: "quarter" } }],
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 4 }] }]],
          virituraGlobal: {
            gradualTempo: {
              position: { fraction: [0, 1] },
              end: { measure: `m${index}`, position: { fraction: [1, 1] } },
              endRatio: index % 2 ? 1.2 : 0.8,
              curve,
              systemTextId: `ramp-label-${index}`,
            },
            systemText: [
              {
                id: `ramp-label-${index}`,
                position: { fraction: [0, 1] },
                placement: "above",
                text: [{ text: `${index % 2 ? "accel." : "rit."} (${curve})` }],
              },
            ],
          },
        })),
      })}
    />
  ),
};
