import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "MNX Spec/Rhythm & Beaming/Rhythmic Spaces",
  component: ScorePreview,
};

export default meta;

/**
 * Two voices demonstrating rhythmic spaces:
 * - Voice 1: quarter notes across the full measure
 * - Voice 2: a half-note space followed by two quarter notes
 *
 * This shows how `type: "space"` creates an explicit rhythmic gap
 * so voices can begin at different positions in the measure.
 */
export const AllVariations: StoryObj = {
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
                  // Voice 1: full measure of quarter notes
                  {
                    content: [
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "E", octave: 5 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "F", octave: 5 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "G", octave: 5 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "A", octave: 5 } }] },
                    ],
                  },
                  // Voice 2: half-note space, then two quarter notes
                  {
                    content: [
                      { type: "space", duration: [1, 2] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "D", octave: 4 } }] },
                    ],
                  },
                ],
              },
              {
                sequences: [
                  // Voice 1: half note then space
                  {
                    content: [
                      { duration: { base: "half" }, notes: [{ pitch: { step: "B", octave: 5 } }] },
                      { type: "space", duration: [1, 2] },
                    ],
                  },
                  // Voice 2: space then half note
                  {
                    content: [
                      { type: "space", duration: [1, 2] },
                      { duration: { base: "half" }, notes: [{ pitch: { step: "E", octave: 4 } }] },
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
  name: "Voice independence with spaces",
};

type InteractiveArgs = { spaceDuration: string };

/**
 * Control the space duration in voice 2.
 * Voice 1 always plays four quarter notes.
 * Voice 2 has a space of the chosen duration, then fills the remainder with notes.
 */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try rhythmic space durations",
  args: { spaceDuration: "half" },
  argTypes: {
    spaceDuration: {
      control: { type: "select" },
      options: ["quarter", "half", "dotted-half"],
    },
  },
  render: ({ spaceDuration }) => {
    // Map duration name to fraction
    const fractionMap: Record<string, number[]> = {
      quarter: [1, 4],
      half: [1, 2],
      "dotted-half": [3, 4],
    };

    // Build voice 2 content: space + remaining notes
    const remainderMap: Record<string, Array<Record<string, unknown>>> = {
      quarter: [
        { duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
        { duration: { base: "quarter" }, notes: [{ pitch: { step: "D", octave: 4 } }] },
        { duration: { base: "quarter" }, notes: [{ pitch: { step: "E", octave: 4 } }] },
      ],
      half: [
        { duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
        { duration: { base: "quarter" }, notes: [{ pitch: { step: "D", octave: 4 } }] },
      ],
      "dotted-half": [{ duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 4 } }] }],
    };

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
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "E", octave: 5 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "F", octave: 5 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "G", octave: 5 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "A", octave: 5 } }] },
                    ],
                  },
                  {
                    content: [
                      { type: "space", duration: fractionMap[spaceDuration] },
                      ...(remainderMap[spaceDuration] ?? []),
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
