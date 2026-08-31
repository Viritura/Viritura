import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "MNX Spec/Notes & Rests/Multi-Measure Rests",
  component: ScorePreview,
};

export default meta;

/**
 * Build MNX JSON with a multimeasure rest spanning `duration` bars.
 * Creates measures before/after the rest region with notes, and empty
 * measures in between that are collapsed by the multimeasureRests directive.
 */
const makeMultimeasureRestMnx = (duration: number) => {
  // First measure has notes, then `duration` empty measures, then a final measure with notes
  const globalMeasures: Record<string, unknown>[] = [{ id: "m1", time: { count: 4, unit: 4 } }];

  // Empty measures for the rest region
  for (let i = 0; i < duration; i++) {
    globalMeasures.push({ id: `mr${i + 1}` });
  }

  // Final measure with notes
  globalMeasures.push({ id: "mEnd" });

  const partMeasures: Record<string, unknown>[] = [
    {
      clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
      sequences: [
        {
          content: [
            {
              duration: { base: "quarter" },
              notes: [{ pitch: { step: "C", octave: 5 } }],
            },
            {
              duration: { base: "quarter" },
              notes: [{ pitch: { step: "D", octave: 5 } }],
            },
            {
              duration: { base: "quarter" },
              notes: [{ pitch: { step: "E", octave: 5 } }],
            },
            {
              duration: { base: "quarter" },
              notes: [{ pitch: { step: "F", octave: 5 } }],
            },
          ],
        },
      ],
    },
  ];

  // Empty measures (whole rests)
  for (let i = 0; i < duration; i++) {
    partMeasures.push({
      sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }],
    });
  }

  // Final measure
  partMeasures.push({
    sequences: [
      {
        content: [
          {
            duration: { base: "quarter" },
            notes: [{ pitch: { step: "G", octave: 5 } }],
          },
          {
            duration: { base: "quarter" },
            notes: [{ pitch: { step: "A", octave: 5 } }],
          },
          {
            duration: { base: "quarter" },
            notes: [{ pitch: { step: "B", octave: 5 } }],
          },
          {
            duration: { base: "quarter" },
            notes: [{ pitch: { step: "C", octave: 6 } }],
          },
        ],
      },
    ],
  });

  return JSON.stringify(
    {
      mnx: { version: 1 },
      layouts: [{ id: "L1", content: [{ type: "staff", sources: [{ part: "P1" }] }] }],
      scores: [
        {
          name: "Score",
          layout: "L1",
          multimeasureRests: [{ start: "mr1", duration }],
        },
      ],
      global: { measures: globalMeasures },
      parts: [{ id: "P1", measures: partMeasures }],
    },
    null,
    2,
  );
};

export const TwoBars: StoryObj = {
  render: () => <ScorePreview mnxJson={makeMultimeasureRestMnx(2)} />,
  name: "Two-bar multi-measure rest",
};

export const FourBars: StoryObj = {
  render: () => <ScorePreview mnxJson={makeMultimeasureRestMnx(4)} />,
  name: "Four-bar multi-measure rest",
};

export const EightBars: StoryObj = {
  render: () => <ScorePreview mnxJson={makeMultimeasureRestMnx(8)} />,
  name: "Eight-bar multi-measure rest",
};

type InteractiveArgs = { duration: number };

/** Control the number of bars collapsed into the multimeasure rest. */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try multi-measure rest lengths",
  args: { duration: 4 },
  argTypes: {
    duration: { control: { type: "number", min: 2, max: 32, step: 1 } },
  },
  render: ({ duration }) => <ScorePreview mnxJson={makeMultimeasureRestMnx(duration)} />,
};
