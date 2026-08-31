import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "MNX Spec/Notes & Rests/Grace-Note Timing",
  component: ScorePreview,
};

export default meta;

/**
 * Helper to build an MNX JSON string with a grace note using the given properties.
 */
const makeGraceMnx = (graceType?: string, slash?: boolean) => {
  const graceObj: Record<string, unknown> = {
    type: "grace",
    content: [
      {
        duration: { base: "eighth" },
        notes: [{ pitch: { step: "D", octave: 5 } }],
      },
    ],
  };
  if (graceType) graceObj.graceType = graceType;
  if (slash !== undefined) graceObj.slash = slash;

  return JSON.stringify(
    {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [
                {
                  content: [
                    graceObj,
                    {
                      duration: { base: "half" },
                      notes: [{ pitch: { step: "C", octave: 5 } }],
                    },
                    {
                      duration: { base: "half" },
                      notes: [{ pitch: { step: "E", octave: 5 } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    null,
    2,
  );
};

/**
 * Default grace note (no `graceType` or `slash` properties supplied — engine
 * defaults to `stealPrevious` with a slash).
 */
export const StealPreviousDefault: StoryObj = {
  render: () => <ScorePreview mnxJson={makeGraceMnx()} />,
  name: "Take time from the previous note (default, slashed)",
};

export const StealPreviousSlash: StoryObj = {
  render: () => <ScorePreview mnxJson={makeGraceMnx("stealPrevious", true)} />,
  name: "Take time from the previous note with a slash",
};

export const StealPreviousNoSlash: StoryObj = {
  render: () => <ScorePreview mnxJson={makeGraceMnx("stealPrevious", false)} />,
  name: "Take time from the previous note without a slash",
};

export const StealFollowingSlash: StoryObj = {
  render: () => <ScorePreview mnxJson={makeGraceMnx("stealFollowing", true)} />,
  name: "Take time from the following note with a slash",
};

export const StealFollowingNoSlash: StoryObj = {
  render: () => <ScorePreview mnxJson={makeGraceMnx("stealFollowing", false)} />,
  name: "Take time from the following note without a slash",
};

export const MakeTimeSlash: StoryObj = {
  render: () => <ScorePreview mnxJson={makeGraceMnx("makeTime", true)} />,
  name: "Add grace-note time with a slash",
};

export const MakeTimeNoSlash: StoryObj = {
  render: () => <ScorePreview mnxJson={makeGraceMnx("makeTime", false)} />,
  name: "Add grace-note time without a slash",
};

type InteractiveArgs = { graceType: string; slash: boolean };

export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try grace-note timing",
  args: { graceType: "stealPrevious", slash: true },
  argTypes: {
    graceType: {
      control: { type: "select" },
      options: ["stealPrevious", "stealFollowing", "makeTime"],
    },
    slash: { control: "boolean" },
  },
  render: ({ graceType, slash }) => <ScorePreview mnxJson={makeGraceMnx(graceType, slash)} />,
};
