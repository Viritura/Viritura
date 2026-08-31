import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Clefs, Keys & Meter/Key Signatures",
  component: ScorePreview,
};

export default meta;

/**
 * All key signatures from C major (0) through sharps (1�7) and flats (-1 to -7)
 * in one multi-measure view (15 measures total).
 */
export const AllKeySignatures: StoryObj = {
  render: () => {
    const fifthsRange = [0, 1, 2, 3, 4, 5, 6, 7, -1, -2, -3, -4, -5, -6, -7];
    const mnx = buildMnx({
      measures: fifthsRange.map((fifths, i) => ({
        ...(i === 0 ? { time: { count: 4, unit: 4 } } : {}),
        key: { fifths },
        voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
      })),
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Key signatures from seven flats to seven sharps",
};

type InteractiveArgs = { fifths: number };

/** Adjust the key signature with a fifths slider (-7 to 7). */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try key signatures",
  args: { fifths: 0 },
  argTypes: {
    fifths: { control: { type: "range", min: -7, max: 7, step: 1 } },
  },
  render: ({ fifths }) => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          key: { fifths },
          voices: [
            [
              { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "F", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const KeyChange: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          key: { fifths: 4 },
          voices: [
            [
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "F", octave: 5, alter: 1 }] },
              { duration: "quarter", notes: [{ step: "G", octave: 5, alter: 1 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
            ],
          ],
        },
        {
          key: { fifths: -4 },
          voices: [
            [
              { duration: "quarter", notes: [{ step: "A", octave: 4, alter: -1 }] },
              { duration: "quarter", notes: [{ step: "B", octave: 4, alter: -1 }] },
              { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "A", octave: 4, alter: -1 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Change from E major to A-flat major",
};
