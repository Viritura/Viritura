import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "Viritura Extensions/Meter & Layout/Multi-instrument Names",
  component: ScorePreview,
};
export default meta;

function namesScore(customLabel = false): string {
  return JSON.stringify({
    mnx: { version: 1 },
    global: {
      measures: [{ id: "m1", time: { count: 4, unit: 4 } }, { id: "m2" }, { id: "m3" }, { id: "m4" }],
    },
    layouts: [
      {
        id: "score",
        content: [
          {
            type: "staff",
            sources: [{ part: "horn" }],
            labelref: "name",
            ...(customLabel ? { label: "Horn player" } : {}),
          },
          { type: "staff", sources: [{ part: "clarinet" }], labelref: "name" },
        ],
      },
    ],
    scores: [
      {
        name: "All required instruments and tunings",
        layout: "score",
        useWritten: true,
        pages: [{ systems: [{ measure: "m1" }, { measure: "m3" }] }],
      },
    ],
    parts: [
      { id: "horn", name: "Horn", shortName: "Hn.", initial: [2, 1], next: [14, 8] },
      { id: "clarinet", name: "Clarinet", shortName: "Cl.", initial: [-3, -2], next: [9, 5] },
    ].map(({ id, name, shortName, initial, next }) => ({
      id,
      name,
      shortName,
      transposition: { interval: { halfSteps: initial[0], staffDistance: initial[1] } },
      measures: Array.from({ length: 4 }, (_, index) => ({
        ...(index === 0 ? { clefs: [{ clef: { sign: "G", staffPosition: -2 } }] } : {}),
        sequences: [
          {
            content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }],
          },
        ],
        ...(index === 1 || index === 3
          ? {
              _x: {
                viritura: {
                  instrumentChanges: [
                    {
                      transposition: {
                        interval: {
                          halfSteps: (index === 1 ? next : initial)[0],
                          staffDistance: (index === 1 ? next : initial)[1],
                        },
                      },
                    },
                  ],
                },
              },
            }
          : {}),
      })),
    })),
  });
}

export const OctaveDistinctTunings: StoryObj = {
  render: () => <ScorePreview mnxJson={namesScore()} />,
};

export const AuthoredLayoutLabel: StoryObj = {
  render: () => <ScorePreview mnxJson={namesScore(true)} />,
};
