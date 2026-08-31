import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Slurs, Ties & Spanners/Ottavas",
  component: ScorePreview,
};

export default meta;

export const OttavaAlta: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          id: "m1",
          time: { count: 4, unit: 4 },
          ottavas: [
            {
              value: 1,
              position: { fraction: [1, 2] },
              end: { measure: "m2", position: { fraction: [1, 2] } },
            },
          ],
          voices: [
            [
              { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
              { duration: "half", notes: [{ step: "C", octave: 7 }] },
            ],
          ],
        },
        {
          id: "m2",
          voices: [
            [
              { duration: "half", notes: [{ step: "E", octave: 7 }] },
              { duration: "quarter", notes: [{ step: "C", octave: 7 }] },
              { duration: "quarter", notes: [{ step: "C", octave: 6 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "8va (ottava alta)",
};

/**
 * All ottava types in separate measures: 8va, 8vb, 15ma, 15mb.
 */
export const AllOttavaTypes: StoryObj = {
  render: () => {
    const _labels: Record<number, string> = { 1: "8va", [-1]: "8vb", 2: "15ma", [-2]: "15mb" };
    const octaves: Record<number, number> = { 1: 7, [-1]: 2, 2: 7, [-2]: 2 };
    const values = [1, -1, 2, -2];

    const measures = values.flatMap((value, i) => {
      const mId = `m${i * 2 + 1}`;
      const mEndId = `m${i * 2 + 2}`;
      const oct = octaves[value];
      return [
        {
          id: mId,
          ...(i === 0 ? { time: { count: 4, unit: 4 } } : {}),
          ottavas: [
            {
              value,
              position: { fraction: [0, 1] },
              end: { measure: mEndId, position: { fraction: [0, 1] } },
            },
          ],
          voices: [
            [
              { duration: "quarter", notes: [{ step: "C", octave: oct }] },
              { duration: "quarter", notes: [{ step: "D", octave: oct }] },
              { duration: "quarter", notes: [{ step: "E", octave: oct }] },
              { duration: "quarter", notes: [{ step: "F", octave: oct }] },
            ],
          ],
        },
        {
          id: mEndId,
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
        },
      ];
    });

    const mnx = buildMnx({ measures });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "All ottava types (8va, 8vb, 15ma, 15mb)",
};

type InteractiveArgs = { value: number };

/** Pick the ottava value with Storybook controls. */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try ottava intervals",
  args: { value: 1 },
  argTypes: {
    value: {
      control: { type: "select" },
      options: [-2, -1, 1, 2],
      labels: { [-2]: "15mb", [-1]: "8vb", 1: "8va", 2: "15ma" },
    },
  },
  render: ({ value }) => {
    const oct = value > 0 ? 7 : 2;
    const mnx = buildMnx({
      measures: [
        {
          id: "m1",
          time: { count: 4, unit: 4 },
          ottavas: [
            {
              value,
              position: { fraction: [0, 1] },
              end: { measure: "m2", position: { fraction: [0, 1] } },
            },
          ],
          voices: [
            [
              { duration: "quarter", notes: [{ step: "C", octave: oct }] },
              { duration: "quarter", notes: [{ step: "D", octave: oct }] },
              { duration: "quarter", notes: [{ step: "E", octave: oct }] },
              { duration: "quarter", notes: [{ step: "F", octave: oct }] },
            ],
          ],
        },
        {
          id: "m2",
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};
