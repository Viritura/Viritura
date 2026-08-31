import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildSingleMeasure } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Articulations & Marks/Bowing Marks",
  component: ScorePreview,
};

export default meta;

/**
 * MNX `bowDirection` marking — string instrument bow indicators.
 * - `direction: "up"` → up-bow (V), SMuFL stringsUpBow (U+E612)
 * - `direction: "down"` → down-bow (∏), SMuFL stringsDownBow (U+E610)
 *
 * Ref: https://w3c-cg.github.io/mnx/docs/mnx-reference/objects/bow-direction/
 */
export const Basic: StoryObj = {
  render: () => {
    const mnx = buildSingleMeasure([
      { duration: "quarter", markings: { bowDirection: { direction: "down" } }, notes: [{ step: "G", octave: 4 }] },
      { duration: "quarter", markings: { bowDirection: { direction: "up" } }, notes: [{ step: "A", octave: 4 }] },
      { duration: "quarter", markings: { bowDirection: { direction: "down" } }, notes: [{ step: "B", octave: 4 }] },
      { duration: "quarter", markings: { bowDirection: { direction: "up" } }, notes: [{ step: "C", octave: 5 }] },
    ]);
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Alternating down-bow and up-bow marks",
};

/** Explicit `orient: "below"` forces the glyph below the staff. */
export const OrientBelow: StoryObj = {
  render: () => {
    const mnx = buildSingleMeasure([
      {
        duration: "quarter",
        markings: { bowDirection: { direction: "down", orient: "below" } },
        notes: [{ step: "G", octave: 4 }],
      },
      {
        duration: "quarter",
        markings: { bowDirection: { direction: "up", orient: "below" } },
        notes: [{ step: "A", octave: 4 }],
      },
      {
        duration: "quarter",
        markings: { bowDirection: { direction: "down", orient: "above" } },
        notes: [{ step: "B", octave: 4 }],
      },
      {
        duration: "quarter",
        markings: { bowDirection: { direction: "up", orient: "above" } },
        notes: [{ step: "C", octave: 5 }],
      },
    ]);
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Bowing marks above and below",
};
