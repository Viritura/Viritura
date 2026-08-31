import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "Engraving Behavior/Rhythm & Spacing/Tuplet Placement",
  component: ScorePreview,
};

export default meta;

// Low notes (below the middle line) have stems up, so the tuplet number sits on
// the stem side (above the staff) and clears the top staff line entirely.
const stemSideLowNotesMnx = JSON.stringify({
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
                  type: "tuplet",
                  inner: { multiple: 3, duration: { base: "eighth" } },
                  outer: { multiple: 2, duration: { base: "eighth" } },
                  content: [
                    { duration: { base: "eighth" }, notes: [{ pitch: { step: "F", octave: 4 } }] },
                    { duration: { base: "eighth" }, notes: [{ pitch: { step: "G", octave: 4 } }] },
                    { duration: { base: "eighth" }, notes: [{ pitch: { step: "A", octave: 4 } }] },
                  ],
                },
                { duration: { base: "half" }, notes: [{ pitch: { step: "F", octave: 4 } }] },
              ],
            },
          ],
        },
      ],
    },
  ],
});

export const VariantStemSideLowNotes: StoryObj = {
  render: () => <ScorePreview mnxJson={stemSideLowNotesMnx} />,
  name: "Stem-side number (low notes, above staff)",
};
