import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "MNX Spec/Rhythm & Beaming/Voice and Tuplet Direction",
  component: ScorePreview,
};

export default meta;

function buildOrientMnx(measures: Record<string, unknown>[]): string {
  return JSON.stringify({
    mnx: { version: 1 },
    global: { measures: measures.map((_, i) => (i === 0 ? { time: { count: 4, unit: 4 } } : {})) },
    parts: [
      {
        measures: measures.map((m, i) => ({
          ...(i === 0 ? { clefs: [{ clef: { sign: "G", staffPosition: -2 } }] } : {}),
          ...m,
        })),
      },
    ],
  });
}

/**
 * All orientation scenarios in one view:
 * Measure 1: sequence orient up (high notes, stems forced up)
 * Measure 2: sequence orient down (low notes, stems forced down)
 * Measure 3: tuplet orient up
 * Measure 4: tuplet orient down
 * Measure 5: event orient overrides sequence orient
 */
export const AllOrientations: StoryObj = {
  render: () => {
    const mnx = buildOrientMnx([
      {
        sequences: [
          {
            orient: "above",
            content: [
              { duration: { base: "quarter" }, notes: [{ pitch: { step: "A", octave: 5 } }] },
              { duration: { base: "quarter" }, notes: [{ pitch: { step: "B", octave: 5 } }] },
              { duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 6 } }] },
              { duration: { base: "quarter" }, notes: [{ pitch: { step: "D", octave: 6 } }] },
            ],
          },
        ],
      },
      {
        sequences: [
          {
            orient: "below",
            content: [
              { duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 3 } }] },
              { duration: { base: "quarter" }, notes: [{ pitch: { step: "D", octave: 3 } }] },
              { duration: { base: "quarter" }, notes: [{ pitch: { step: "E", octave: 3 } }] },
              { duration: { base: "quarter" }, notes: [{ pitch: { step: "F", octave: 3 } }] },
            ],
          },
        ],
      },
      {
        sequences: [
          {
            content: [
              {
                type: "tuplet",
                orient: "above",
                inner: { multiple: 3, duration: { base: "eighth" } },
                outer: { multiple: 2, duration: { base: "eighth" } },
                content: [
                  { duration: { base: "eighth" }, notes: [{ pitch: { step: "A", octave: 5 } }] },
                  { duration: { base: "eighth" }, notes: [{ pitch: { step: "B", octave: 5 } }] },
                  { duration: { base: "eighth" }, notes: [{ pitch: { step: "C", octave: 6 } }] },
                ],
              },
              { duration: { base: "half" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
            ],
          },
        ],
      },
      {
        sequences: [
          {
            content: [
              {
                type: "tuplet",
                orient: "below",
                inner: { multiple: 3, duration: { base: "eighth" } },
                outer: { multiple: 2, duration: { base: "eighth" } },
                content: [
                  { duration: { base: "eighth" }, notes: [{ pitch: { step: "C", octave: 3 } }] },
                  { duration: { base: "eighth" }, notes: [{ pitch: { step: "D", octave: 3 } }] },
                  { duration: { base: "eighth" }, notes: [{ pitch: { step: "E", octave: 3 } }] },
                ],
              },
              { duration: { base: "half" }, notes: [{ pitch: { step: "F", octave: 5 } }] },
            ],
          },
        ],
      },
      {
        sequences: [
          {
            orient: "above",
            content: [
              { duration: { base: "quarter" }, orient: "below", notes: [{ pitch: { step: "C", octave: 4 } }] },
              { duration: { base: "quarter" }, notes: [{ pitch: { step: "D", octave: 4 } }] },
              { duration: { base: "quarter" }, orient: "below", notes: [{ pitch: { step: "E", octave: 4 } }] },
              { duration: { base: "quarter" }, notes: [{ pitch: { step: "F", octave: 4 } }] },
            ],
          },
        ],
      },
    ]);
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Voice, tuplet, and individual stem directions",
};

type InteractiveArgs = {
  orient: "above" | "down";
};

/** Pick sequence orientation with Storybook controls. */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try voice and tuplet directions",
  args: {
    orient: "above",
  },
  argTypes: {
    orient: {
      control: { type: "select" },
      options: ["up", "down"],
    },
  },
  render: ({ orient }) => {
    const mnx = buildOrientMnx([
      {
        sequences: [
          {
            orient,
            content: [
              { duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
              { duration: { base: "quarter" }, notes: [{ pitch: { step: "D", octave: 4 } }] },
              { duration: { base: "quarter" }, notes: [{ pitch: { step: "E", octave: 4 } }] },
              { duration: { base: "quarter" }, notes: [{ pitch: { step: "F", octave: 4 } }] },
            ],
          },
        ],
      },
    ]);
    return <ScorePreview mnxJson={mnx} />;
  },
};
