import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Viritura Extensions/Techniques & Ornaments/Ornaments",
  component: ScorePreview,
};

export default meta;

const ALL_ORNAMENTS = [
  "turn",
  "invertedTurn",
  "mordent",
  "invertedMordent",
  "trillMordent",
  "delayedTurn",
  "schleifer",
];

/** All 7 ornament types in one measure. */
export const AllOrnaments: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 7, unit: 4 },
          voices: [
            ALL_ORNAMENTS.map((o) => ({
              duration: "quarter" as const,
              virituraMarkings: { ornaments: [o] },
              notes: [{ step: "E", octave: 5 }],
            })),
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "All seven ornament types",
};

type InteractiveArgs = { ornament: string };

/** Pick ornament type with Storybook controls. */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try ornament types",
  args: { ornament: "turn" },
  argTypes: {
    ornament: { control: { type: "select" }, options: ALL_ORNAMENTS },
  },
  render: ({ ornament }) => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", virituraMarkings: { ornaments: [ornament] }, notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", virituraMarkings: { ornaments: [ornament] }, notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", virituraMarkings: { ornaments: [ornament] }, notes: [{ step: "C", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "B", octave: 4 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};
