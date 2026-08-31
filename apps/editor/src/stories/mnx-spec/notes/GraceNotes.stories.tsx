import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import graceNotesBeamedMnx from "../../../../../../packages/format/fixtures/mnx/grace-notes-beamed.mnx?raw";

const meta: Meta = {
  title: "MNX Spec/Notes & Rests/Grace Notes",
  component: ScorePreview,
};

export default meta;

export const SingleGraceNote: StoryObj = {
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
                        type: "grace",
                        content: [
                          {
                            duration: { base: "eighth" },
                            notes: [{ pitch: { step: "B", octave: 4 } }],
                          },
                        ],
                      },
                      {
                        duration: { base: "whole" },
                        notes: [{ pitch: { step: "C", octave: 5 } }],
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
  name: "Single grace note",
};

export const MultipleGraceNotes: StoryObj = {
  render: () => {
    return <ScorePreview mnxJson={graceNotesBeamedMnx} />;
  },
  name: "Multiple grace notes",
};
