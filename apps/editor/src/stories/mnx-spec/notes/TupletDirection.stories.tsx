import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "MNX Spec/Rhythm & Beaming/Tuplet Direction",
  component: ScorePreview,
};

export default meta;

function buildPlacementMnx(measures: Record<string, unknown>[]): string {
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
 * Tuplet bracket/number placement scenarios:
 * Measure 1: tuplet placement above
 * Measure 2: tuplet placement below
 */
export const AllPlacements: StoryObj = {
  render: () => {
    const mnx = buildPlacementMnx([
      {
        sequences: [
          {
            content: [
              {
                type: "tuplet",
                placement: "above",
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
                placement: "below",
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
    ]);
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Above and below tuplet placement",
};

type InteractiveArgs = {
  placement: "above" | "below";
};

/** Pick tuplet placement with Storybook controls. */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try tuplet placement",
  args: {
    placement: "above",
  },
  argTypes: {
    placement: {
      control: { type: "select" },
      options: ["above", "below"],
    },
  },
  render: ({ placement }) => {
    const mnx = buildPlacementMnx([
      {
        sequences: [
          {
            content: [
              {
                type: "tuplet",
                placement,
                inner: { multiple: 3, duration: { base: "eighth" } },
                outer: { multiple: 2, duration: { base: "eighth" } },
                content: [
                  { duration: { base: "eighth" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
                  { duration: { base: "eighth" }, notes: [{ pitch: { step: "D", octave: 4 } }] },
                  { duration: { base: "eighth" }, notes: [{ pitch: { step: "E", octave: 4 } }] },
                ],
              },
              { duration: { base: "half" }, notes: [{ pitch: { step: "G", octave: 4 } }] },
            ],
          },
        ],
      },
    ]);
    return <ScorePreview mnxJson={mnx} />;
  },
};
