import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildSingleMeasure } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Slurs, Ties & Spanners/Tremolos",
  component: ScorePreview,
};

export default meta;

export const SingleNoteTremolo: StoryObj = {
  render: () => {
    const mnx = buildSingleMeasure([
      { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
      { duration: "quarter", markings: { tremolo: { marks: 1 } }, notes: [{ step: "C", octave: 5 }] },
      { duration: "quarter", markings: { tremolo: { marks: 2 } }, notes: [{ step: "C", octave: 5 }] },
      { duration: "quarter", markings: { tremolo: { marks: 3 } }, notes: [{ step: "C", octave: 5 }] },
    ]);
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Single-note tremolos with one to three strokes",
};

const makeMultiNoteTremoloMnx = (marks: number) =>
  JSON.stringify(
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
                    {
                      type: "tremolo",
                      marks,
                      outer: { duration: { base: "half" }, multiple: 1 },
                      content: [
                        {
                          duration: { base: "half" },
                          notes: [{ pitch: { step: "C", octave: 4 } }],
                        },
                        {
                          duration: { base: "half" },
                          notes: [{ pitch: { step: "E", octave: 4 } }],
                        },
                      ],
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

/**
 * Shows 1-mark, 2-mark, and 3-mark multi-note tremolos side by side.
 * Each uses two half notes with tremolo marks between them.
 */
export const MultiNoteTremolo: StoryObj = {
  render: () => {
    const mnx = JSON.stringify(
      {
        mnx: { version: 1 },
        global: {
          measures: [{ time: { count: 4, unit: 4 } }, {}, {}],
        },
        parts: [
          {
            measures: [
              {
                clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
                sequences: [
                  {
                    content: [
                      {
                        type: "tremolo",
                        marks: 1,
                        outer: { duration: { base: "half" }, multiple: 1 },
                        content: [
                          {
                            duration: { base: "half" },
                            notes: [{ pitch: { step: "C", octave: 4 } }],
                          },
                          {
                            duration: { base: "half" },
                            notes: [{ pitch: { step: "E", octave: 4 } }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                sequences: [
                  {
                    content: [
                      {
                        type: "tremolo",
                        marks: 2,
                        outer: { duration: { base: "half" }, multiple: 1 },
                        content: [
                          {
                            duration: { base: "half" },
                            notes: [{ pitch: { step: "D", octave: 4 } }],
                          },
                          {
                            duration: { base: "half" },
                            notes: [{ pitch: { step: "F", octave: 4 } }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                sequences: [
                  {
                    content: [
                      {
                        type: "tremolo",
                        marks: 3,
                        outer: { duration: { base: "half" }, multiple: 1 },
                        content: [
                          {
                            duration: { base: "half" },
                            notes: [{ pitch: { step: "E", octave: 4 } }],
                          },
                          {
                            duration: { base: "half" },
                            notes: [{ pitch: { step: "G", octave: 4 } }],
                          },
                        ],
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
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Multi-note tremolos with one to three strokes",
};

type InteractiveArgs = { marks: number };

export const MultiNoteInteractive: StoryObj<InteractiveArgs> = {
  args: { marks: 2 },
  argTypes: {
    marks: { control: { type: "select" }, options: [1, 2, 3] },
  },
  render: ({ marks }) => <ScorePreview mnxJson={makeMultiNoteTremoloMnx(marks)} />,
  name: "Try multi-note tremolo strokes",
};
