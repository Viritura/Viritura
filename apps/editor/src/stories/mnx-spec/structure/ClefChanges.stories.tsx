import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Clefs, Keys & Meter/Clefs",
  component: ScorePreview,
};

export default meta;

/** Treble, Bass, Alto, and Tenor clefs � one per measure. */
export const AllClefs: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          clef: { sign: "G", staffPosition: -2 },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
        },
        {
          clef: { sign: "F", staffPosition: 2 },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 3 }] }]],
        },
        {
          clef: { sign: "C", staffPosition: 0 },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 4 }] }]],
        },
        {
          clef: { sign: "C", staffPosition: 2 },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 4 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Treble, bass, alto, and tenor clefs",
};

type InteractiveArgs = {
  sign: "G" | "F" | "C";
  staffPosition: number;
  octave: number;
};

/** Pick clef sign, staff position, and octave transposition. */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try clef positions and octaves",
  args: {
    sign: "G",
    staffPosition: -2,
    octave: 0,
  },
  argTypes: {
    sign: {
      control: { type: "select" },
      options: ["G", "F", "C"],
    },
    staffPosition: {
      control: { type: "range", min: -4, max: 4, step: 1 },
    },
    octave: {
      control: { type: "range", min: -2, max: 2, step: 1 },
      description: "Octave transposition (0 = none, -1 = 8vb, 1 = 8va)",
    },
  },
  render: ({ sign, staffPosition, octave }) => {
    const clef: { sign: string; staffPosition: number; octave?: number } = { sign, staffPosition };
    if (octave !== 0) clef.octave = octave;
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          clef,
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 4 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

/** Mid-piece clef change: Treble ? Bass across two measures. */
export const ClefChange: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          clef: { sign: "G", staffPosition: -2 },
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
          clef: { sign: "F", staffPosition: 2 },
          voices: [
            [
              { duration: "quarter", notes: [{ step: "C", octave: 3 }] },
              { duration: "quarter", notes: [{ step: "D", octave: 3 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 3 }] },
              { duration: "quarter", notes: [{ step: "F", octave: 3 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Change from treble to bass clef",
};
