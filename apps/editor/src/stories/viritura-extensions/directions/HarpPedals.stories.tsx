import type { Meta, StoryObj } from "@storybook/react-vite";
import type { HarpPedalSetting, HarpPedalTuning } from "@viritura/core";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Viritura Extensions/Techniques & Ornaments/Harp Pedals",
  component: ScorePreview,
};

export default meta;

const NATURAL: HarpPedalTuning = { D: 0, C: 0, B: 0, E: 0, F: 0, G: 0, A: 0 };
const A_FLAT_MAJOR: HarpPedalTuning = { D: -1, C: 0, B: -1, E: -1, F: 0, G: 0, A: -1 };
const E_MAJOR: HarpPedalTuning = { D: 1, C: 1, B: 0, E: 0, F: 1, G: 1, A: 0 };

function harpScore(tunings: HarpPedalTuning[], staff?: number): string {
  return buildMnx({
    partName: "Harp",
    staves: 2,
    measures: tunings.map((tuning, index) => {
      const setting: HarpPedalSetting = {
        id: `harp-setting-${index}`,
        position: { fraction: [0, 1] },
        tuning,
        source: "manual",
        ...(staff !== undefined ? { staff } : {}),
      };
      return {
        id: `m${index + 1}`,
        ...(index === 0
          ? {
              time: { count: 4, unit: 4 },
              clefs: [
                { clef: { sign: "G", staffPosition: -2 }, staff: 1 },
                { clef: { sign: "F", staffPosition: 2 }, staff: 2 },
              ],
            }
          : {}),
        voices: [
          [
            { duration: "half", notes: [{ step: "C", octave: 5, alter: tuning.C }], staff: 1 },
            { duration: "half", notes: [{ step: "E", octave: 5, alter: tuning.E }], staff: 1 },
          ],
          [{ duration: "whole", notes: [{ step: "A", octave: 2, alter: tuning.A }], staff: 2 }],
        ],
        virituraPartMeasure: { harpPedals: [setting] },
      };
    }),
  });
}

export const CommonTunings: StoryObj = {
  name: "C major, A-flat major, E major",
  render: () => <ScorePreview mnxJson={harpScore([NATURAL, A_FLAT_MAJOR, E_MAJOR])} />,
};

export const AllPedalPositions: StoryObj = {
  name: "All flat, all natural, all sharp",
  render: () => (
    <ScorePreview
      mnxJson={harpScore([
        { D: -1, C: -1, B: -1, E: -1, F: -1, G: -1, A: -1 },
        NATURAL,
        { D: 1, C: 1, B: 1, E: 1, F: 1, G: 1, A: 1 },
      ])}
    />
  ),
};

export const UpperStaffPlacement: StoryObj = {
  name: "Diagram below the upper staff",
  render: () => <ScorePreview mnxJson={harpScore([A_FLAT_MAJOR], 1)} />,
};

export const MidMeasureChange: StoryObj = {
  name: "Pedal change at beat three",
  render: () => (
    <ScorePreview
      mnxJson={buildMnx({
        partName: "Harp",
        measures: [
          {
            id: "m1",
            time: { count: 4, unit: 4 },
            voices: [
              [
                { duration: "half", notes: [{ step: "E", octave: 4 }] },
                { duration: "half", notes: [{ step: "E", octave: 4, alter: -1 }] },
              ],
            ],
            virituraPartMeasure: {
              harpPedals: [
                { id: "start", position: { fraction: [0, 1] }, tuning: NATURAL },
                { id: "change", position: { fraction: [1, 2] }, tuning: A_FLAT_MAJOR },
              ] satisfies HarpPedalSetting[],
            },
          },
        ],
      })}
    />
  ),
};
