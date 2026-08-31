import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "Engraving Behavior/Staves, Systems & Scores/Braces",
  component: ScorePreview,
};

export default meta;

function w(step: string, octave: number) {
  return { type: "event", duration: { base: "whole" }, notes: [{ pitch: { step, octave } }] };
}

// ---------------------------------------------------------------------------
// Story 4: Brace scaling across group sizes
//   One brace over 1, 2, 3 and 5 staves. SMuFL cuts the brace one em tall and
//   has it scaled to the height it spans; fonts ship alternates so that a taller
//   span takes a narrower, flatter design instead of a blown-up wide one.
// ---------------------------------------------------------------------------

const braceStaffCounts = [1, 2, 3, 5];

const braceScalingMnx = JSON.stringify(
  {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 0 } }] },
    parts: braceStaffCounts.map((staves, groupIndex) => ({
      id: `g${groupIndex}`,
      name: `${staves} staff`,
      staves,
      measures: [
        {
          clefs: Array.from({ length: staves }, (_, s) => ({
            clef: { sign: "G", staffPosition: -2 },
            staff: s + 1,
          })),
          sequences: Array.from({ length: staves }, (_, s) => ({
            staff: s + 1,
            content: [w("B", 4)],
          })),
        },
      ],
    })),
    layouts: [
      {
        id: "L",
        content: braceStaffCounts.map((staves, groupIndex) => ({
          type: "group",
          symbol: "brace",
          barlineStyle: "unified",
          content: Array.from({ length: staves }, (_, s) => ({
            type: "staff",
            sources: [{ part: `g${groupIndex}`, staff: s + 1 }],
          })),
        })),
      },
    ],
    scores: [{ name: "Score", layout: "L" }],
  },
  null,
  2,
);

/**
 * Brace scaling: one brace over 1, 2, 3 and 5 staves.
 *
 * Each brace spans its group exactly, but the taller ones are not simply the
 * short one blown up — they take progressively narrower, flatter cuts of the
 * glyph, which is what keeps a brace over five staves from reading as a heavy
 * black stroke beside the music.
 */
export const BraceScaling: StoryObj = {
  render: () => <ScorePreview mnxJson={braceScalingMnx} />,
  name: "Brace scaling across one to five staves",
};
