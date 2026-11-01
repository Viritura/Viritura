import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Barlines, Repeats & Navigation/Repeats",
  component: ScorePreview,
};

export default meta;

export const SimpleRepeat: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          repeatStart: true,
          repeatEnd: true,
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Simple repeat",
};

export const RepeatWithEndings: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          repeatStart: true,
          voices: [
            [
              { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "F", octave: 5 }] },
            ],
          ],
        },
        {
          ending: { duration: 1, numbers: [1] },
          repeatEnd: true,
          voices: [[{ duration: "whole", notes: [{ step: "G", octave: 5 }] }]],
        },
        {
          ending: { duration: 1, numbers: [2] },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 6 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Repeat with first and second endings",
};

/**
 * Open ending � a volta bracket with no closing hook on the right side.
 * Uses `open: true` on the ending property.
 */
export const OpenEnding: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          repeatStart: true,
          voices: [
            [
              { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "F", octave: 5 }] },
            ],
          ],
        },
        {
          ending: { duration: 1, numbers: [1], open: true },
          repeatEnd: true,
          voices: [[{ duration: "whole", notes: [{ step: "G", octave: 5 }] }]],
        },
        {
          ending: { duration: 1, numbers: [2] },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 6 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Open ending without a right hook",
};

/**
 * Multi-measure ending � a volta bracket spanning 2 measures.
 * Uses `duration: 2` on the ending property.
 */
export const MultiMeasureEnding: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          repeatStart: true,
          voices: [
            [
              { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "F", octave: 5 }] },
            ],
          ],
        },
        {
          voices: [
            [
              { duration: "quarter", notes: [{ step: "G", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "A", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "B", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "C", octave: 6 }] },
            ],
          ],
        },
        {
          ending: { duration: 2, numbers: [1] },
          voices: [[{ duration: "whole", notes: [{ step: "D", octave: 6 }] }]],
        },
        {
          repeatEnd: true,
          voices: [[{ duration: "whole", notes: [{ step: "E", octave: 6 }] }]],
        },
        {
          ending: { duration: 1, numbers: [2] },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 6 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Two-bar ending",
};

export const EndingAcrossSystems: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: Array.from({ length: 24 }, (_, index) => ({
        ...(index === 0 ? { time: { count: 4, unit: 4 }, repeatStart: true } : {}),
        ...(index === 1 ? { ending: { duration: 12, numbers: [1] } } : {}),
        ...(index === 12 ? { repeatEnd: true } : {}),
        ...(index === 13 ? { ending: { duration: 1, numbers: [2], open: true } } : {}),
        voices: [
          Array.from({ length: 4 }, () => ({
            duration: "quarter",
            notes: ["C", "E", "G", "B"].map((step) => ({ step, octave: 5 })),
          })),
        ],
      })),
    });
    return <ScorePreview mnxJson={mnx} viewMode="page" />;
  },
  name: "Ending continues across systems to the repeat barline",
};

/**
 * Repeat with explicit play count � `repeatEnd.times` controls how many
 * times the section is played (default 2 when omitted). Here we test 3� and 4�.
 */
export const RepeatWithCount: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          repeatStart: true,
          repeatEnd: { times: 3 },
          voices: [
            [
              { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "F", octave: 5 }] },
            ],
          ],
        },
        {
          repeatStart: true,
          repeatEnd: { times: 4 },
          voices: [
            [
              { duration: "half", notes: [{ step: "G", octave: 5 }] },
              { duration: "half", notes: [{ step: "A", octave: 5 }] },
            ],
          ],
        },
        {
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 6 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Repeat with third- and fourth-pass counts",
};
