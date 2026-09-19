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

export const ConsecutiveDecoratedGraces: StoryObj = {
  name: "Consecutive dotted graces with accidentals and flags",
  parameters: {
    docs: {
      description: {
        story:
          "Two un-beamed dotted eighth-note graces, C5 then C♯5, precede a principal C5. " +
          "Check that grace flags and dots clear the following sharp and principal natural.",
      },
    },
  },
  render: () => {
    const mnx = JSON.stringify(
      {
        // Honor the empty beam list so consecutive graces retain individual flags.
        mnx: { version: 1, support: { useBeams: true } },
        global: { measures: [{ time: { count: 4, unit: 4 } }] },
        parts: [
          {
            measures: [
              {
                clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
                beams: [],
                sequences: [
                  {
                    content: [
                      {
                        type: "grace",
                        slash: false,
                        content: [
                          {
                            duration: { base: "eighth", dots: 1 },
                            orient: "above",
                            notes: [{ pitch: { step: "C", octave: 5 } }],
                          },
                          {
                            duration: { base: "eighth", dots: 1 },
                            orient: "above",
                            notes: [{ pitch: { step: "C", octave: 5, alter: 1 } }],
                          },
                        ],
                      },
                      {
                        duration: { base: "whole" },
                        notes: [
                          {
                            pitch: { step: "C", octave: 5 },
                            accidentalDisplay: { show: true, force: true },
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
};
