import type { Meta, StoryObj } from "@storybook/react-vite";
import type { HarpPedalDisplay, HarpPedalSetting, HarpPedalTuning, MultiStaffPlacement } from "@viritura/core";
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

interface HarpScoreOptions {
  staff?: number;
  placements?: Array<MultiStaffPlacement | undefined>;
  displays?: Array<HarpPedalDisplay | undefined>;
  settingIndices?: number[];
}

function harpScore(
  tunings: HarpPedalTuning[],
  { staff, placements, displays, settingIndices }: HarpScoreOptions = {},
): string {
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
        ...(placements?.[index] !== undefined ? { placement: placements[index] } : {}),
        ...(displays?.[index] !== undefined ? { display: displays[index] } : {}),
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
          {
            staff: 1,
            events: [
              { duration: "half", notes: [{ step: "C", octave: 5, alter: tuning.C }] },
              { duration: "half", notes: [{ step: "E", octave: 5, alter: tuning.E }] },
            ],
          },
          {
            staff: 2,
            events: [{ duration: "whole", notes: [{ step: "A", octave: 2, alter: tuning.A }] }],
          },
        ],
        ...(settingIndices === undefined || settingIndices.includes(index)
          ? { virituraPartMeasure: { harpPedals: [setting] } }
          : {}),
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
  render: () => <ScorePreview mnxJson={harpScore([A_FLAT_MAJOR], { staff: 1 })} />,
};

export const PlacementOptions: StoryObj = {
  name: "Above, between, and below",
  render: () => (
    <ScorePreview
      mnxJson={harpScore([A_FLAT_MAJOR, NATURAL, E_MAJOR], { placements: ["above", "between", "below"] })}
    />
  ),
};

export const FullPedalDiagram: StoryObj = {
  name: "Full pedal diagram",
  render: () => <ScorePreview mnxJson={harpScore([A_FLAT_MAJOR], { displays: ["diagram"] })} />,
};

export const FullWrittenPedals: StoryObj = {
  name: "Full written pedals",
  render: () => (
    <ScorePreview
      mnxJson={harpScore([A_FLAT_MAJOR, A_FLAT_MAJOR, A_FLAT_MAJOR], {
        displays: ["names"],
        settingIndices: [0],
      })}
    />
  ),
};

export const ChangedWrittenPedals: StoryObj = {
  name: "Written pedal changes",
  render: () => (
    <ScorePreview
      mnxJson={harpScore([NATURAL, { ...NATURAL, E: -1 }, A_FLAT_MAJOR], {
        displays: ["diagram", "changes", "changes"],
      })}
    />
  ),
};

export const DisplayModes: StoryObj = {
  name: "Diagram, all names, and changes only",
  render: () => (
    <ScorePreview
      mnxJson={harpScore([NATURAL, A_FLAT_MAJOR, E_MAJOR, NATURAL], {
        displays: ["diagram", "names", "changes", "changes"],
      })}
    />
  ),
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
