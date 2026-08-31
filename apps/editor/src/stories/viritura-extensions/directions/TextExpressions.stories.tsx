import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Viritura Extensions/Expressions & Labels/Text Expressions",
  component: ScorePreview,
};

export default meta;

export const Dolce: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", notes: [{ step: "E", octave: 4 }] },
              { duration: "quarter", notes: [{ step: "F", octave: 4 }] },
              { duration: "quarter", notes: [{ step: "G", octave: 4 }] },
              { duration: "quarter", notes: [{ step: "A", octave: 4 }] },
            ],
          ],
          dynamics: [{ value: "p", position: { fraction: [0, 1] } }],
          virituraPartMeasure: {
            expressions: [{ text: "dolce", position: { fraction: [0, 1] } }],
          },
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Dolce expression",
};

export const MultipleExpressions: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "half", notes: [{ step: "C", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "B", octave: 4 }] },
              { duration: "quarter", notes: [{ step: "A", octave: 4 }] },
            ],
          ],
          virituraPartMeasure: {
            expressions: [
              { text: "espressivo", position: { fraction: [0, 1] } },
              { text: "rit.", position: { fraction: [1, 2] } },
            ],
          },
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Multiple expressions",
};
