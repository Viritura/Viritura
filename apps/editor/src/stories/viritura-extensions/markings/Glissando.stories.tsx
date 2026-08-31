import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Viritura Extensions/Techniques & Ornaments/Glissandi",
  component: ScorePreview,
};

export default meta;

/** Both glissando styles (straight + wavy) in one measure. */
export const AllGlissandoStyles: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                duration: "quarter",
                id: "ev1",
                notes: [{ step: "C", octave: 4 }],
                virituraExtensions: { glissandos: [{ target: "ev2", style: "straight" }] },
              },
              { duration: "quarter", id: "ev2", notes: [{ step: "E", octave: 5 }] },
              {
                duration: "quarter",
                id: "ev3",
                notes: [{ step: "G", octave: 5 }],
                virituraExtensions: { glissandos: [{ target: "ev4", style: "wavy" }] },
              },
              { duration: "quarter", id: "ev4", notes: [{ step: "C", octave: 4 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Straight and wavy glissandi",
};

type InteractiveArgs = { lineType: string };

/** Pick glissando line type with Storybook controls. */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try glissando line types",
  args: { lineType: "straight" },
  argTypes: {
    lineType: { control: { type: "select" }, options: ["straight", "wavy"] },
  },
  render: ({ lineType }) => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                duration: "half",
                id: "ev1",
                notes: [{ step: "C", octave: 4 }],
                virituraExtensions: { glissandos: [{ target: "ev2", style: lineType }] },
              },
              { duration: "half", id: "ev2", notes: [{ step: "E", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};
