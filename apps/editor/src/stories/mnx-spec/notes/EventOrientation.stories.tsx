import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "MNX Spec/Notes & Rests/Stem Direction",
  component: ScorePreview,
};

export default meta;

function buildEventOrientMnx(measures: Record<string, unknown>[]): string {
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
 * All event orientation scenarios in one view:
 * Measure 1: orient="up" on high notes (stems forced up)
 * Measure 2: orient="down" on low notes (stems forced down)
 * Measure 3: auto (no orient, default stem direction by pitch)
 */
export const AllOrientations: StoryObj = {
  render: () => {
    const mnx = buildEventOrientMnx([
      {
        sequences: [
          {
            content: [
              { duration: { base: "quarter" }, orient: "above", notes: [{ pitch: { step: "A", octave: 5 } }] },
              { duration: { base: "quarter" }, orient: "above", notes: [{ pitch: { step: "B", octave: 5 } }] },
              { duration: { base: "quarter" }, orient: "above", notes: [{ pitch: { step: "C", octave: 6 } }] },
              { duration: { base: "quarter" }, orient: "above", notes: [{ pitch: { step: "D", octave: 6 } }] },
            ],
          },
        ],
      },
      {
        sequences: [
          {
            content: [
              { duration: { base: "quarter" }, orient: "below", notes: [{ pitch: { step: "C", octave: 3 } }] },
              { duration: { base: "quarter" }, orient: "below", notes: [{ pitch: { step: "D", octave: 3 } }] },
              { duration: { base: "quarter" }, orient: "below", notes: [{ pitch: { step: "E", octave: 3 } }] },
              { duration: { base: "quarter" }, orient: "below", notes: [{ pitch: { step: "F", octave: 3 } }] },
            ],
          },
        ],
      },
      {
        sequences: [
          {
            content: [
              { duration: { base: "quarter" }, notes: [{ pitch: { step: "A", octave: 5 } }] },
              { duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 3 } }] },
              { duration: { base: "quarter" }, notes: [{ pitch: { step: "B", octave: 5 } }] },
              { duration: { base: "quarter" }, notes: [{ pitch: { step: "D", octave: 3 } }] },
            ],
          },
        ],
      },
    ]);
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Upward, downward, and automatic stems",
};

type InteractiveArgs = { orient: string };

/** Pick event orientation with Storybook controls. */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try stem directions",
  args: { orient: "above" },
  argTypes: {
    orient: { control: { type: "select" }, options: ["up", "down", "auto"] },
  },
  render: ({ orient }) => {
    const orientProp = orient === "auto" ? undefined : orient;
    const mnx = buildEventOrientMnx([
      {
        sequences: [
          {
            content: [
              {
                duration: { base: "quarter" },
                ...(orientProp && { orient: orientProp }),
                notes: [{ pitch: { step: "C", octave: 4 } }],
              },
              {
                duration: { base: "quarter" },
                ...(orientProp && { orient: orientProp }),
                notes: [{ pitch: { step: "E", octave: 4 } }],
              },
              {
                duration: { base: "quarter" },
                ...(orientProp && { orient: orientProp }),
                notes: [{ pitch: { step: "G", octave: 5 } }],
              },
              {
                duration: { base: "quarter" },
                ...(orientProp && { orient: orientProp }),
                notes: [{ pitch: { step: "B", octave: 5 } }],
              },
            ],
          },
        ],
      },
    ]);
    return <ScorePreview mnxJson={mnx} />;
  },
};
