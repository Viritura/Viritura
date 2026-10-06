import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";
import { ERASING_STAFF_TEXT_MNX } from "../../storyFixtures/textFrameScore";

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
            expressions: [{ text: [{ text: "dolce" }], position: { fraction: [0, 1] } }],
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
              { text: [{ text: "espressivo" }], position: { fraction: [0, 1] } },
              { text: [{ text: "rit." }], position: { fraction: [1, 2] } },
            ],
          },
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Multiple expressions",
};

export const SystemText: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
          virituraGlobal: {
            systemText: [
              {
                id: "editorial-note",
                text: [{ text: "Asterisk refers to the editorial note below.", style: { fontStyle: "italic" } }],
                position: { fraction: [0, 1] },
                placement: "above",
                frame: { width: { unit: "staffSpaces", value: 24 }, border: "solid", padding: 0.5 },
              },
            ],
          },
        },
        {
          voices: [[{ duration: "whole", notes: [{ step: "D", octave: 5 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "System text at the visible staff boundary",
};

export const FramedStaffText: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
          virituraPartMeasure: {
            expressions: [
              {
                text: [
                  { text: "Play freely\n", style: { weight: "bold" } },
                  { text: "Then resume the pulse without a break" },
                ],
                position: { fraction: [0, 1] },
                placement: "above",
                frame: {
                  width: { unit: "staffSpaces", value: 18 },
                  padding: 0.5,
                  border: "solid",
                  paragraphJustification: "center",
                },
              },
            ],
          },
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Staff text with wrapping and frame",
};

export const EraseBackground: StoryObj = {
  render: () => <ScorePreview mnxJson={ERASING_STAFF_TEXT_MNX} />,
  name: "Erase background over staff ink",
};
