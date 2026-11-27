import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "Viritura Extensions/Techniques & Ornaments/Global Fermatas",
  component: ScorePreview,
};

export default meta;

export const DifferentRhythmsAndLocalOverride: StoryObj = {
  name: "Different rhythms and local override",
  render: () => (
    <ScorePreview
      mnxJson={JSON.stringify({
        mnx: { version: 1 },
        global: {
          measures: [
            {
              time: { count: 4, unit: 4 },
              _x: {
                viritura: {
                  fermatas: [
                    {
                      id: "ensemble-hold",
                      position: { fraction: [5, 8] },
                      multiplier: 2,
                      clickBehavior: "silent",
                    },
                  ],
                },
              },
            },
          ],
        },
        parts: [
          {
            name: "Sustained voices",
            measures: [
              {
                clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
                sequences: [
                  {
                    directionHint: "upper",
                    content: [
                      {
                        duration: { base: "whole" },
                        notes: [{ pitch: { step: "G", octave: 5 } }],
                        fermata: {
                          symbol: "square",
                          _x: { viritura: { localOnly: true } },
                        },
                      },
                    ],
                  },
                  {
                    directionHint: "lower",
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
            name: "Moving rhythm",
            measures: [
              {
                clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
                sequences: [
                  {
                    content: [
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 5 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "D", octave: 5 } }] },
                      { duration: { base: "quarter" }, rest: {} },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "F", octave: 5 } }] },
                    ],
                  },
                ],
              },
            ],
          },
          {
            name: "Resting staff",
            measures: [
              {
                clefs: [{ clef: { sign: "F", staffPosition: 2 } }],
                sequences: [{ content: [], fullMeasure: {} }],
              },
            ],
          },
        ],
      })}
    />
  ),
};
