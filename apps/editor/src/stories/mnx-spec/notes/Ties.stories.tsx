import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "MNX Spec/Slurs, Ties & Spanners/Ties/Basics",
  component: ScorePreview,
};

export default meta;

export const SimpleTie: StoryObj = {
  render: () => {
    const mnx = JSON.stringify(
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
                        duration: { base: "quarter" },
                        notes: [{ pitch: { step: "C", octave: 5 } }],
                      },
                      {
                        duration: { base: "quarter" },
                        notes: [{ id: "n1", pitch: { step: "E", octave: 5 }, ties: [{ target: "n2" }] }],
                      },
                      {
                        duration: { base: "quarter" },
                        notes: [{ id: "n2", pitch: { step: "E", octave: 5 } }],
                      },
                      {
                        duration: { base: "quarter" },
                        notes: [{ pitch: { step: "G", octave: 5 } }],
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
  name: "Simple tie",
};

export const TieAcrossBarline: StoryObj = {
  render: () => {
    const mnx = JSON.stringify(
      {
        mnx: { version: 1 },
        global: {
          measures: [{ time: { count: 4, unit: 4 } }, {}],
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
                        duration: { base: "half" },
                        notes: [{ pitch: { step: "C", octave: 5 } }],
                      },
                      {
                        duration: { base: "half" },
                        notes: [{ id: "n3", pitch: { step: "E", octave: 5 }, ties: [{ target: "n4" }] }],
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
                        duration: { base: "half" },
                        notes: [{ id: "n4", pitch: { step: "E", octave: 5 } }],
                      },
                      {
                        duration: { base: "half" },
                        notes: [{ pitch: { step: "G", octave: 5 } }],
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
  name: "Tie across a barline",
};
